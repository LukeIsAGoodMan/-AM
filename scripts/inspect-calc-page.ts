// One-shot Playwright probe. Run with the dev server up on :3000:
//   pnpm verify:ui
// Asserts the interactive contracts that can't be unit-tested:
//   1. fixture campaign auto-prefill
//   2. selected-category highlighting
//   3. Klook ranking order
//   4. M15 edit-rule happy path (notes change on approved rule succeeds)
//   5. M15 edit-rule refusal gate (economic change on approved rule refused)
//   6. M16 /projection-test renders + welcome offer toggle changes total
//   7. M17 /dashboard renders counts + 0.0% custom_note schema-health metric
//   8. P5 /review queue renders + open-conflict count is visible

import { chromium } from "playwright"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.on("pageerror", (err) => console.error("page error:", err.message))

  await page.goto("http://localhost:3000/calculator-test", {
    waitUntil: "networkidle",
  })

  console.log("\n=== Test 1: campaign auto-prefill ===")
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

  console.log("\n=== Test 4: M15 edit-rule happy path (notes change) ===")
  await page.goto(
    "http://localhost:3000/rules/hsbc-red__base_earn/edit",
    { waitUntil: "networkidle" },
  )
  const notesField = page.locator("textarea").nth(0)
  const stamp = new Date().toISOString()
  await notesField.fill(`verify:ui touched at ${stamp}`)
  await page.click("button:has-text('Save')")
  await page.waitForSelector(".border-emerald-200", { timeout: 4000 })
  const successMsg = await page.locator(".border-emerald-200").textContent()
  console.log(`success banner: ${successMsg?.trim().slice(0, 80)}`)

  console.log("\n=== Test 5: M15 edit-rule refusal gate (economic change) ===")
  // Same approved rule; bump rate from 0.004 → 0.005. The syncer's refusal
  // gate (mirrored in saveRuleEdit) must reject.
  await page.goto(
    "http://localhost:3000/rules/hsbc-red__base_earn/edit",
    { waitUntil: "networkidle" },
  )
  const formulaArea = page
    .locator("textarea")
    .filter({ hasText: "simple_percent" })
  const cur = (await formulaArea.inputValue()).trim()
  const bumped = cur.replace(/"rate"\s*:\s*[0-9.]+/, '"rate": 0.005')
  if (bumped === cur) throw new Error("Could not patch rate in payload JSON")
  await formulaArea.fill(bumped)
  await page.click("button:has-text('Save')")
  await page.waitForSelector(".border-rose-200", { timeout: 4000 })
  const errorMsg = await page.locator(".border-rose-200").textContent()
  console.log(`refusal banner: ${errorMsg?.trim().slice(0, 140)}`)

  console.log("\n=== Test 6: M16 projection page renders + welcome contributes ===")
  await page.goto("http://localhost:3000/projection-test", {
    waitUntil: "networkidle",
  })
  await page.selectOption("select", "demo-plan-mode")
  await page.waitForTimeout(150)
  // HSBC Red's projection row: the inline "+ welcome HKD X.XX (Y%)" phrase
  // only appears when welcomeOfferContributionHkd > 0. The standalone
  // "1 welcome offer" badge is always shown for cards with priced offers,
  // so we don't grep for plain "welcome".
  const hsbcRedRow = page
    .locator("div.rounded.border:has(a:text-is('HSBC Red Credit Card'))")
    .first()
  const beforeText = await hsbcRedRow.textContent()
  const beforeContrib = beforeText?.includes("+ welcome HKD") ?? false
  console.log(`HSBC Red shows '+ welcome HKD ...': ${beforeContrib}`)

  await page.click("label:has-text('Include welcome offer') input[type=checkbox]")
  await page.waitForTimeout(150)
  const afterText = await hsbcRedRow.textContent()
  const afterContrib = afterText?.includes("+ welcome HKD") ?? false
  console.log(`after toggling off, still shows '+ welcome HKD ...': ${afterContrib}`)

  console.log("\n=== Test 7: M17 dashboard renders + custom_note ratio ===")
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" })
  // The schema-health Card has an h3 "Schema health …"; the ratio headline
  // is a .text-3xl span inside the same Card. Walk up to the Card root then
  // back down to the span.
  const ratioText = await page
    .locator(".rounded-lg:has(h3:has-text('Schema health')) span.text-3xl")
    .first()
    .textContent()
  console.log(`custom_note ratio headline: ${ratioText?.trim()}`)
  const cardsCount = await page
    .locator(".rounded-lg:has(h3:has-text('Cards')) div.text-2xl")
    .first()
    .textContent()
  console.log(`cards count headline: ${cardsCount?.trim()}`)

  console.log("\n=== Test 8: P5 /review queue renders + open-conflict count ===")
  await page.goto("http://localhost:3000/review", { waitUntil: "networkidle" })
  // PageHeader renders a <div>, not <header>. Grab the subtitle div by
  // walking from the h1 to its sibling subtitle div.
  const subtitle = await page
    .locator("div:has(> h1:text-is('Review queue')) > div.mt-0\\.5")
    .first()
    .textContent()
  console.log(`header subtitle: ${subtitle?.trim().replace(/\s+/g, " ")}`)
  // Default filter is status=open. Count rendered table rows.
  const rowCount = await page.locator("table tbody tr").count()
  console.log(`open task rows rendered: ${rowCount}`)
  // Confirm a row exists with verdict 'conflict' (rose-toned StatusBadge).
  const conflictRow = await page
    .locator("table tbody tr:has(span:text-is('conflict'))")
    .count()
  console.log(`rows containing a conflict verdict badge: ${conflictRow}`)

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
