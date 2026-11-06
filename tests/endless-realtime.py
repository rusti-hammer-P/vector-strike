"""Bounded live-RAF Playwright check for endless mode.

All game simulation uses the normal browser RAF. The script observes only public
read-only game state and observed blips, then sends ordinary browser mouse/keys.
It is scripted automation, not a human play/feel assessment.
"""
from pathlib import Path
import json
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "tests" / "artifacts" / "endless"
ARTIFACTS.mkdir(parents=True, exist_ok=True)
MAX_SECONDS_PER_VIEWPORT = 70
server = subprocess.Popen(
    [sys.executable, "-u", "-c",
     "import http.server,os; os.chdir(" + repr(str(ROOT)) + "); "
     "s=http.server.ThreadingHTTPServer(('127.0.0.1',0),http.server.SimpleHTTPRequestHandler); "
     "print(s.server_port,flush=True); s.serve_forever()"],
    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
PORT = int(server.stdout.readline().strip())


def ready():
    for _ in range(50):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/index.html") as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise AssertionError("HTTP server did not become ready")


def run_viewport(browser, width, height):
    context = browser.new_context(viewport={"width": width, "height": height})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text)
            if message.type == "error" else None)
    page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="networkidle")
    assert page.evaluate("__GAME_STATE__.state") == "TITLE"
    if page.locator("#first-run-guide").is_visible():
        page.locator("#btn-dismiss-guide").click()
    page.locator("#btn-start-endless").click()
    assert page.evaluate("__GAME_STATE__.mode") == "ENDLESS"

    # Import the game's observed-only predictor; do not mutate or freeze game state.
    page.evaluate("""async () => {
      const m = await import('./src/engine.js');
      window.__READONLY_OBSERVED_PREDICTIONS__ = () => {
        const g = window.__GAME_STATE__;
        const ids = [...new Set(g.blipHistory.map(b => b.targetId))];
        return ids.map(id => ({
          id,
          prediction: m.computeDynamicLeadPrediction(g, id),
          latest: g.blipHistory.find(b => b.targetId === id) || null
        })).filter(item => item.prediction && item.latest);
      };
    }""")

    canvas = page.locator("#radar-canvas")
    rect = canvas.bounding_box()
    assert rect and rect["width"] > 0 and rect["height"] > 0

    def canvas_point(x, y):
        return (rect["x"] + (480 + x) / 960 * rect["width"],
                rect["y"] + (360 + y) / 720 * rect["height"])

    def move_to(x, y):
        page.mouse.move(*canvas_point(x, y))

    def snapshot():
        return page.evaluate("""() => {
          const g = __GAME_STATE__, e = g.endless;
          return {
            state:g.state, wave:e?.wave ?? 0, hp:e?.hp ?? 0,
            kills:e?.kills ?? 0, shots:e?.shots ?? 0, hitShots:e?.hitShots ?? 0,
            ammo:g.ammo, reload:e?.reloadRemaining ?? 0,
            rest:e?.restRemaining ?? 0, bulletActive:!!g.bullet?.active,
            targetCount:g.targets.filter(t=>!t.destroyed&&!t.breached).length,
            roundTime:g.roundTime, lastEvent:e?.lastEvent ?? '',
            observed:g.blipHistory.map(b=>({
              id:b.targetId,x:b.x,y:b.y,r:b.r,theta:b.theta,at:b.detectedAt
            }))
          };
        }""")

    started = time.monotonic()
    next_input_at = 0.0
    wave_inputs = set()
    screenshot_saved = False
    miss_attempt = None
    verified_miss = False
    refired_after_miss = False
    max_live = 0
    all_ids = set()
    selected_ids = []
    shot_log = []
    input_log = []
    last_shots = 0
    last_wave = 0
    last_hp = 5
    phase_screenshots = set()
    quiet_saved = False
    evolution_saved = False
    next_wave_saved = False

    while time.monotonic() - started < MAX_SECONDS_PER_VIEWPORT:
        s = snapshot()
        elapsed = time.monotonic() - started
        max_live = max(max_live, s["targetCount"])
        all_ids.update(b["id"] for b in s["observed"])
        if s["wave"] != last_wave:
            last_wave = s["wave"]
            if s["wave"] >= 1:
                print(f"{width}x{height} wave={s['wave']} t={elapsed:.1f}s hp={s['hp']}")
        if s["hp"] < last_hp:
            last_hp = s["hp"]
        phase = page.evaluate("__GAME_STATE__.endless.phase")
        if phase in ("CLEANUP", "REST") and phase not in phase_screenshots:
            page.screenshot(path=str(ARTIFACTS / f"{width}-realtime-{phase.lower()}.png"))
            phase_screenshots.add(phase)
        if phase == "REST" and s["rest"] < 1.8 and not quiet_saved:
            page.screenshot(path=str(ARTIFACTS / f"{width}-realtime-quiet.png"))
            quiet_saved = True
        if s["wave"] == 2 and not next_wave_saved:
            page.screenshot(path=str(ARTIFACTS / f"{width}-realtime-next-wave.png"))
            next_wave_saved = True
        if not evolution_saved and page.evaluate(
                "__GAME_STATE__.blipHistory.some(b=>b.form?.name==='HYPER LANCE')"):
            page.screenshot(path=str(ARTIFACTS / f"{width}-realtime-common-d.png"))
            evolution_saved = True

        # Capture the actual unpaused multi-enemy display at each requested size.
        if (not screenshot_saved and s["state"] == "PLAYING" and s["wave"] >= 3 and
                s["targetCount"] >= 4 and len({b["id"] for b in s["observed"]}) >= 3):
            page.screenshot(path=str(ARTIFACTS / f"{width}-realtime-multiple.png"))
            screenshot_saved = True

        # Exercise each available input style during live combat, at most once/wave.
        if s["state"] == "PLAYING" and s["wave"] not in wave_inputs:
            if s["wave"] == 1:
                move_to(0, 0)
                page.mouse.click(*canvas_point(0, 0), button="right")
                input_log.append({"wave": 1, "input": "right-click tactical pulse"})
            elif s["wave"] == 2:
                page.keyboard.press("Shift")
                input_log.append({"wave": 2, "input": "Shift tactical pulse"})
            elif s["wave"] >= 3:
                page.keyboard.press("e")
                input_log.append({"wave": s["wave"], "input": "E tactical pulse"})
            wave_inputs.add(s["wave"])

        # One planned empty-space shot checks miss/reload/refire using real input.
        # Its direction is selected from the largest gap between observed bearings;
        # no true target coordinates are consulted.
        if (miss_attempt is None and s["wave"] >= 2 and s["state"] == "PLAYING" and
                s["ammo"] == 1 and not s["bulletActive"] and len(s["observed"]) >= 2 and
                elapsed > 10):
            angles = sorted({(b["theta"] + 2 * 3.141592653589793) %
                             (2 * 3.141592653589793) for b in s["observed"]})
            gaps = []
            for index, angle in enumerate(angles):
                following = angles[(index + 1) % len(angles)]
                if index + 1 == len(angles):
                    following += 2 * 3.141592653589793
                gaps.append((following - angle, angle + (following-angle)/2))
            _, gap_angle = max(gaps)
            miss_point = (300 * __import__("math").cos(gap_angle),
                          300 * __import__("math").sin(gap_angle))
            move_to(*miss_point)
            page.mouse.click(*canvas_point(*miss_point), button="left")
            miss_attempt = {
                "at": elapsed, "wave": s["wave"], "shotsBefore": s["shots"],
                "hitsBefore": s["hitShots"], "angleFromObservedGap": round(gap_angle, 3)
            }
            shot_log.append({"wave": s["wave"], "method": "mouse planned miss"})
            next_input_at = elapsed + 0.8
            print(f"{width}x{height} planned miss attempt at {elapsed:.1f}s")

        if miss_attempt and not verified_miss:
            if (not s["bulletActive"] and s["shots"] > miss_attempt["shotsBefore"] and
                    s["hitShots"] == miss_attempt["hitsBefore"] and
                    "命中なし" in s["lastEvent"]):
                verified_miss = True
                miss_attempt["verified"] = True
                miss_attempt["missAt"] = elapsed
                print(f"{width}x{height} verified miss at {elapsed:.1f}s")

        # On Wave 3, deliberately observe the natural four-enemy cap before
        # resuming observed-prediction aiming; this is not a scripted state/time step.
        hold_for_four = s["wave"] == 3 and not screenshot_saved and (
            s["targetCount"] < 4 or len({b["id"] for b in s["observed"]}) < 3)
        # Leave W1's final reaction until the finite assault has ended. This
        # captures reinforcement-end with a real survivor, then a safe clear.
        hold_for_cleanup = s["wave"] == 1 and page.evaluate(
            "__GAME_STATE__.endless.spawned === 3 && __GAME_STATE__.endless.phase === 'ASSAULT'")
        if (s["state"] == "PLAYING" and not hold_for_four and not hold_for_cleanup and elapsed >= next_input_at and
                s["ammo"] == 1 and not s["bulletActive"]):
            candidates = page.evaluate("window.__READONLY_OBSERVED_PREDICTIONS__()")
            # Prioritize the most advanced observed threat, and use only its
            # observation-derived lead prediction for actual aiming.
            if candidates:
                choice = min(candidates, key=lambda item: item["latest"]["r"])
                point = (choice["prediction"]["x"], choice["prediction"]["y"])
                move_to(*point)
                page.wait_for_timeout(70)  # Normal RAF continues while input settles.
                before = snapshot()
                if (before["state"] == "PLAYING" and before["ammo"] == 1 and
                        not before["bulletActive"]):
                    selected = page.locator("#hud-threat").inner_text().strip()
                    if selected and selected not in selected_ids:
                        selected_ids.append(selected)
                    if before["wave"] % 2 == 0:
                        page.keyboard.press("Space")
                        method = "Space"
                    else:
                        page.mouse.click(*canvas_point(*point), button="left")
                        method = "mouse-left"
                    after = snapshot()
                    if after["shots"] > before["shots"]:
                        shot_log.append({
                            "wave": before["wave"], "method": method,
                            "observedId": choice["id"], "observedAge": round(
                                before["roundTime"] - choice["latest"]["detectedAt"], 2),
                            "prediction": [round(point[0], 1), round(point[1], 1)]
                        })
                        print(f"{width}x{height} shot {after['shots']} W{before['wave']} "
                              f"via {method} at {elapsed:.1f}s, aimed from {choice['id']}")
                        if verified_miss and not refired_after_miss and \
                                after["shots"] > miss_attempt["shotsBefore"] + 1:
                            refired_after_miss = True
                            miss_attempt["refireAt"] = elapsed
                    next_input_at = elapsed + 0.18

        if s["state"] in ("ENDLESS_RESULT", "TITLE"):
            break
        page.wait_for_timeout(90)

    end = snapshot()
    duration = time.monotonic() - started
    result = {
        "viewport": f"{width}x{height}", "durationSeconds": round(duration, 1),
        "state": end["state"], "wave": end["wave"], "hp": end["hp"],
        "kills": end["kills"], "shots": end["shots"], "hitShots": end["hitShots"],
        "maxSimultaneousEnemies": max_live, "observedIds": sorted(all_ids),
        "targetHudValues": selected_ids, "shotInputs": shot_log, "otherInputs": input_log,
        "plannedMiss": miss_attempt, "missVerified": verified_miss,
        "refiredAfterMiss": refired_after_miss, "screenshot": screenshot_saved,
        "pageErrors": errors
    }
    assert not errors, errors
    assert end["wave"] >= 3 or end["state"] == "ENDLESS_RESULT", result
    assert len(all_ids) >= 3 and max_live >= 4, result
    assert screenshot_saved, result
    assert phase_screenshots == {"CLEANUP", "REST"}, phase_screenshots
    assert quiet_saved and next_wave_saved and evolution_saved
    assert any(item["method"] == "Space" for item in shot_log), result
    assert any(item["method"] == "mouse-left" for item in shot_log), result
    print("LIVE_RESULT " + json.dumps({key:result[key] for key in [
        "viewport", "durationSeconds", "state", "wave", "hp", "kills", "shots",
        "hitShots", "maxSimultaneousEnemies", "missVerified", "refiredAfterMiss",
        "screenshot", "pageErrors"]}, ensure_ascii=False))
    context.close()
    return result


try:
    ready()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            print("Chromium:", browser.version, "normal requestAnimationFrame")
            results = [
                run_viewport(browser, 1504, 784),
                run_viewport(browser, 1600, 900),
            ]
            assert all(item["wave"] >= 2 or item["state"] == "ENDLESS_RESULT"
                       for item in results)
            assert all(item["missVerified"] and item["refiredAfterMiss"]
                       for item in results), results
        finally:
            browser.close()
finally:
    server.terminate()
    server.wait(timeout=5)
    print("Owned temporary HTTP server stopped:", server.pid, server.poll())
