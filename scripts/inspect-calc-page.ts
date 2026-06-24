// One-shot Playwright probe of /calculator-test. Run with the dev server
// up on :3000: pnpm tsx scripts/inspect-calc-page.ts

import { chromium } from "playwright"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.on("pageerror", (err) => console.error("page error:", err.message))

  await page.goto("http://localhost:3000/calculator-test", {
    waitUntil: "networkidle",
  })

  console.log("\n=== Test 1: campaign auto-prefill ===")
  // The specific campaign opt-in checkbox lives next to the campaign name.
  const campaignBox = page.locator(
    "li.flex.items-center.gap-1\\.5:has(span:text('HSBC Red — Q3 2026 Online Extra 2%')) input[type=checkbox]",
  )
  console.log(`initial checked: ${await campaignBox.isChecked()}`)

  await page.selectOption("select", "hsbc-red-online-optin")
  await page.waitForTimeout(150)
  console.log(`after REGISTERED fixture: ${await campaignBox.isChecked()}`)

  await page.selectOption("select", "hsbc-red-online-noopt")
  await page.waitForTimeout(150)
  console.log(`after NOT-registered fixture: ${await campaignBox.isChecked()}`)

  console.log("\n=== Test 2: enJoy selected-category ===")
  const enjoyDining = page.locator(
    "li.py-2:has(span:text('Hang Seng enJoy Card')) button:text-is('dining_local')",
  )
  await page.selectOption("select", "enjoy-dining-selected")
  await page.waitForTimeout(150)
  const classWithSelected = await enjoyDining.getAttribute("class")
  console.log(
    `enJoy dining_local button after IS-selected fixture: highlighted=${classWithSelected?.includes("emerald")}`,
  )

  console.log("\n=== Test 3: Klook ranking ===")
  await page.selectOption("select", "klook-5k-online")
  await page.waitForTimeout(150)
  const rankItems = await page
    .locator("div.rounded.border.border-neutral-200 div.bg-neutral-50 span")
    .allTextContents()
  console.log("first ranks:", rankItems.slice(0, 12))

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
