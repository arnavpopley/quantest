import sys, os, time
from playwright.sync_api import sync_playwright

root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(out, exist_ok=True)
url = "file://" + os.path.join(root, "index.html")

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("dialog", lambda d: d.accept())
    page.on("console", lambda m: errors.append("console." + m.type + ": " + m.text) if m.type in ("error", "warning") else None)
    page.goto(url)
    page.wait_for_timeout(800)
    page.screenshot(path=f"{out}/01-learn.png", full_page=False)

    # start first lesson
    page.click(".node.current button")
    page.wait_for_timeout(400)
    page.fill("input.bid", "60")
    page.fill("input.ask", "120")
    page.wait_for_timeout(200)
    page.screenshot(path=f"{out}/02-quote.png")
    page.click(".lesson-foot .btn")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{out}/03-after-quote.png")
    # play through remaining rounds quickly
    for i in range(4):
        page.click(".lesson-foot .btn")  # next round
        page.wait_for_timeout(300)
        page.fill("input.bid", str(70 + i * 5))
        page.fill("input.ask", str(110 - i * 5))
        page.click(".lesson-foot .btn")
        page.wait_for_timeout(300)
    page.click(".lesson-foot .btn")  # settle
    page.wait_for_timeout(600)
    page.screenshot(path=f"{out}/04-result.png", full_page=False)
    page.click(".lesson-top .close")
    page.wait_for_timeout(300)

    # games page
    page.goto(url + "#games")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{out}/05-games.png")

    # daily
    page.click("#main .game-card >> text=Daily #")
    page.wait_for_timeout(500)
    page.fill("input.bid", "100")
    page.fill("input.ask", "1000")
    page.click(".lesson-foot .btn")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{out}/06-daily.png")
    page.click(".lesson-top .close")
    page.wait_for_timeout(300)

    # card sum
    page.goto(url + "#games")
    page.wait_for_timeout(400)
    page.click("text=Card sum")
    page.wait_for_timeout(400)
    page.fill("input.bid", "31")
    page.fill("input.ask", "39")
    page.click(".lesson-foot .btn")
    page.wait_for_timeout(400)
    page.screenshot(path=f"{out}/07-cards.png")
    page.click(".lesson-top .close")
    page.wait_for_timeout(300)

    # dice
    page.click("text=Dice ladder")
    page.wait_for_timeout(400)
    page.click("text=Peek a die")
    page.wait_for_timeout(300)
    page.fill("input.bid", "15")
    page.fill("input.ask", "20")
    page.screenshot(path=f"{out}/08-dice.png")
    page.click(".lesson-top .close")
    page.wait_for_timeout(300)

    # arena
    page.click("text=Spread arena")
    page.wait_for_timeout(400)
    page.click(".lesson-foot .btn")
    page.wait_for_timeout(3000)
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(2000)
    page.screenshot(path=f"{out}/09-arena.png")
    page.click(".lesson-top .close")
    page.wait_for_timeout(300)

    # host a room
    page.click("text=Host a room")
    page.wait_for_timeout(400)
    page.screenshot(path=f"{out}/10-room.png")

    # mobile
    ctx2 = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True)
    m = ctx2.new_page()
    m.on("pageerror", lambda e: errors.append("mobile pageerror: " + str(e)))
    m.goto(url)
    m.wait_for_timeout(600)
    m.screenshot(path=f"{out}/11-mobile-learn.png")
    m.click(".node.current button")
    m.wait_for_timeout(400)
    m.fill("input.bid", "60")
    m.fill("input.ask", "120")
    m.wait_for_timeout(200)
    m.screenshot(path=f"{out}/12-mobile-quote.png")
    b.close()

print("\n".join(errors) if errors else "no console errors")
