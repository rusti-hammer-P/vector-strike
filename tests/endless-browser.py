"""Real Chromium canvas/DOM/input checks. Deterministic stepping except final live RAF.
Run with /home/natsuki/work/nas/.venv/bin/python; no dependencies installed.
Gallery is explicitly render-only; natural observations are tested separately.
"""
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "tests" / "artifacts" / "endless-approved"
ARTIFACTS.mkdir(parents=True, exist_ok=True)
# Bind an ephemeral private port before advertising readiness; never contact an
# unrelated server if an old fixed test port is already in use.
server = subprocess.Popen(
    [sys.executable, "-u", "-c",
     "import http.server,os; os.chdir(" + repr(str(ROOT)) + "); "
     "s=http.server.ThreadingHTTPServer(('127.0.0.1',0),http.server.SimpleHTTPRequestHandler); "
     "print(s.server_port,flush=True); s.serve_forever()"],
    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
try:
    port = int(server.stdout.readline().strip())
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html", timeout=5) as r:
        assert r.status == 200
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            print("Chromium", browser.version)
            for width, height in [(1504, 784), (1600, 900)]:
                context = browser.new_context(viewport={"width": width, "height": height})
                context.add_init_script("window.requestAnimationFrame=()=>0")
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
                page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="networkidle")
                ev = page.evaluate
                def step(s):
                    ev("s=>__GAME_TEST__.step(0.01,Math.round(s*100))", s)
                def shot_count():
                    return ev("__GAME_STATE__.endless.shots")
                def screenshot(name):
                    page.screenshot(path=str(ARTIFACTS / f"{width}-{name}.png"))
                def canvas_point(x, y):
                    r = page.locator("#radar-canvas").bounding_box()
                    return r["x"]+(480+x)/960*r["width"], r["y"]+(360+y)/720*r["height"]
                def fits(selector):
                    box = page.locator(selector).bounding_box()
                    assert box and box["x"] >= 0 and box["y"] >= 0, (selector, box)
                    assert box["x"]+box["width"] <= width+1, (selector, box)
                    assert box["y"]+box["height"] <= height+1, (selector, box)
                    assert page.locator(selector).evaluate("e=>e.scrollWidth<=e.clientWidth+1"), selector
                page.locator("#btn-dismiss-guide").click()
                for selector in ["#btn-start-endless", "#endless-description", "#radar-canvas"]:
                    fits(selector)
                text = page.locator("#endless-description").inner_text()
                assert "ランスIII" in text and "偽像" in text and "同じ系統" not in text
                screenshot("title")
                page.locator("#btn-start-endless").focus()
                page.keyboard.down("Enter")
                assert ev("__GAME_STATE__.mode") == "ENDLESS"
                page.wait_for_timeout(270)
                step(0.3)
                page.keyboard.down("Enter")
                assert shot_count() == 0
                page.keyboard.up("Enter")
                ev("__GAME_TEST__.startEndless(0)")
                page.mouse.click(*canvas_point(-200, 0))
                assert shot_count() == 1
                page.mouse.click(*canvas_point(-200, 0), button="right")
                assert ev("__GAME_STATE__.tacticalPingRemaining") == 0
                step(1.99)
                assert ev("__GAME_STATE__.ammo") == 0
                page.keyboard.down("Space")
                assert shot_count() == 1
                step(0.01)
                page.keyboard.down("Space")
                assert shot_count() == 1
                page.keyboard.up("Space")
                page.keyboard.press("Space")
                assert shot_count() == 2
                screenshot("reload-input")

                # Natural spawns and real sweep observations for every common key.
                for wave, kind, seconds in [(1,"L",2),(3,"D",2),(2,"C",2),
                        (12,"V",2),(4,"B",7.5),(9,"P",6.5),(5,"S",4.5),
                        (10,"H",3),(7,"M",2),(7,"F",2),(8,"Q",2)]:
                    ev("""w=>{
                      __GAME_TEST__.startEndless(0.35);
                      const g=__GAME_STATE__;
                      if(w>1){g.endless.wave=w-1;g.state='WAVE_REST';g.endless.restRemaining=0.01;}
                    }""", wave)
                    if wave > 1:
                        step(0.01)
                    step(seconds)
                    b = ev("""k=>{
                      const g=__GAME_STATE__,t=g.targets.find(t=>t.kind===k);
                      return g.blipHistory.find(b=>b.targetId===t?.id)||null;
                    }""", kind)
                    assert b and b["shapeType"], (wave, kind)
                    page.mouse.move(*canvas_point(b["x"], b["y"]))
                    step(0.01)
                    assert b["form"]["name"] in page.locator("#hud-round-desc").inner_text()
                    screenshot(f"natural-{kind}")
                    if kind == "F":
                        assert not b["isDecoyEcho"]
                        page.keyboard.press("e")
                        step(0.25)
                        assert ev("__GAME_STATE__.blipHistory.some(b=>b.isDecoyEcho)")
                        screenshot("natural-F-revealed")

                # Canvas trace: exact normal/danger status hues per shape, no
                # campaign MKII/boost/canard multicolour leaking into endless.
                ev("""async()=>{
                  const {RadarRenderer}=await import('./src/renderer.js');
                  window.__rendererModule=await import('./src/renderer.js');
                }""")
                colors = ev("""async()=>{
                  const {ENDLESS_FORMS:F}=await import('./src/engine.js');
                  const mod=await import('./src/renderer.js');
                  const Renderer=mod.RadarRenderer || mod.default;
                  const canvas=document.querySelector('#radar-canvas');
                  const renderer=new Renderer(canvas);
                  const ctx=canvas.getContext('2d'),g=__GAME_STATE__,results=[];
                  const oldStroke=ctx.stroke,oldFill=ctx.fill;
                  for(const [key,form] of Object.entries(F))for(const danger of [false,true]){
                    const used=[];
                    ctx.stroke=function(){used.push(this.strokeStyle);return oldStroke.apply(this,arguments)};
                    ctx.fill=function(){used.push(this.fillStyle);return oldFill.apply(this,arguments)};
                    const b={id:1,targetId:'gallery-'+key,form,shapeType:form.shapeType,
                      isDecoy:key==='F',isDecoyEcho:false,x:0,y:0,r:danger?95:200,theta:0,
                      heading:0,turnDir:1,isBoosted:true,detectedAt:g.roundTime-1,round:10};
                    renderer.drawBlipShape(ctx,g,b,0,1,danger&&key!=='F',false);
                    results.push({key,danger,used});
                  }
                  ctx.stroke=oldStroke;ctx.fill=oldFill;return results;
                }""")
                for item in colors:
                    expected = "#ff2a55" if item["danger"] and item["key"] != "F" else "#00ffaa"
                    assert set(c.lower() for c in item["used"]) == {expected}, item

                # Render-only gallery: all silhouettes, three-line measured/clamped
                # labels at the rim and a decaying history sample. No simulation.
                ev("""async()=>{
                  const {ENDLESS_FORMS:F}=await import('./src/engine.js');
                  __GAME_TEST__.startEndless(0);
                  const g=__GAME_STATE__;g.roundTime=20;g.targets=[];g.blipHistory=[];
                  const coords=[[335,0],[-335,0],[0,335],[0,-335],[235,235],[-235,235],
                    [-235,-235],[235,-235],[150,0],[-150,0],[0,160]];
                  Object.entries(F).forEach(([key,form],i)=>{
                    const [x,y]=coords[i],id='gallery-'+key;
                    g.targets.push({id,destroyed:false,breached:false});
                    g.blipHistory.push({id:i,targetId:id,form,shapeType:form.shapeType,
                      x,y,r:Math.hypot(x,y),theta:Math.atan2(y,x),heading:0,turnDir:1,
                      isBoosted:true,isDecoy:key==='F',isDecoyEcho:false,
                      detectedAt:19.9,round:10,source:'sweep'});
                  });
                  window.__labels=[];
                  const proto=CanvasRenderingContext2D.prototype,old=proto.fillText;
                  proto.fillText=function(text,x,y){
                    const m=this.measureText(text);
                    __labels.push({text:String(text),x,y,align:this.textAlign,fill:this.fillStyle,
                      width:m.width,ascent:m.actualBoundingBoxAscent||10,
                      descent:m.actualBoundingBoxDescent||3});
                    return old.apply(this,arguments);
                  };
                  const mod=await import('./src/renderer.js');
                  const R=mod.RadarRenderer||mod.default;new R(document.querySelector('#radar-canvas')).render(g);
                }""")
                labels = ev("__labels.filter(l=>l.text.startsWith('gallery-')||/^\\d+m \\(\\+/.test(l.text)||Object.values(__GAME_STATE__.blipHistory).some(b=>b.form.name===l.text))")
                assert len(labels) == 33, len(labels)
                for label in labels:
                    left = label["x"] - (label["width"] if label["align"] == "right" else
                                        label["width"]/2 if label["align"] == "center" else 0)
                    assert left >= -472.01 and left+label["width"] <= 472.01, label
                    assert label["y"]-label["ascent"] >= -352.01, label
                    assert label["y"]+label["descent"] <= 352.01, label
                screenshot("common-Q-F-gallery")
                ev("""async()=>{
                  const g=__GAME_STATE__,b=g.blipHistory.find(b=>b.form.name==='PHANTOM BLINK');
                  g.blipHistory=[{...b,x:-95,y:0,r:95}];
                  const mod=await import('./src/renderer.js');
                  const R=mod.RadarRenderer||mod.default;new R(document.querySelector('#radar-canvas')).render(g);
                }""")
                screenshot("danger-P")
                # Natural loss, retry, title, then campaign routing.
                ev("__GAME_TEST__.startEndless(0)")
                step(65)
                assert ev("__GAME_STATE__.state") == "ENDLESS_RESULT"
                assert "命中率 —" in page.locator("#endless-result-detail").inner_text()
                screenshot("result")
                page.wait_for_timeout(270)
                page.locator("#btn-endless-retry").click()
                assert ev("__GAME_STATE__.endless.hp") == 5
                page.wait_for_timeout(270)
                page.locator("#btn-mode-title").click()
                assert ev("__GAME_STATE__.state") == "TITLE"
                page.wait_for_timeout(270)
                page.locator("#btn-start-operation").click()
                assert ev("__GAME_STATE__.mode") == "CAMPAIGN"
                assert not errors, errors
                print(f"PASS {width}x{height}: 11 natural forms + F reveal, 22 monochrome traces, "
                      "33 clamped labels, real mouse/keys/repeats/reload/result/retry/title, errors=0")
                context.close()
            live = browser.new_page(viewport={"width":1504,"height":784})
            live.goto(f"http://127.0.0.1:{port}/index.html",wait_until="networkidle")
            live.evaluate("__GAME_TEST__.startEndless(0)")
            angle=live.evaluate("__GAME_STATE__.aimAngle")
            live.keyboard.down("ArrowRight")
            live.wait_for_timeout(180)
            live.keyboard.up("ArrowRight")
            assert live.evaluate("__GAME_STATE__.aimAngle") > angle
            live.keyboard.press("m")
            assert "OFF" in live.locator("#btn-mute").inner_text()
            live.keyboard.press("t")
            assert live.evaluate("__GAME_STATE__.state") == "TITLE"
            print("PASS live RAF keyboard aim / mute toggle / title")
            live.close()
        finally:
            browser.close()
finally:
    server.terminate()
    server.wait(timeout=5)
    print("Owned temporary HTTP server stopped:", server.pid, server.poll())
