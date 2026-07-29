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
//   9. P6 /review/[taskId] detail renders + approve+reopen roundtrip works
//  10. P7 /rules surfaces xchk__-prefixed materialized rules
//  11. P10 /dashboard renders the Phase 2 extraction telemetry card
//  12. P10 /rules/[xchk__-slug] renders the cross-check provenance card

import { chromium } from "playwright"

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.on("pageerror", (err) => console.error("page error:", err.message))

  await page.goto("http://localhost:3000/calculator-test", {
    waitUntil: "networkidle",
  })

  // P18: editing is now password-gated (view stays open). Unlock so the
  // edit tests (4/5/9/13) can drive the mutating actions.
  console.log("\n=== Test 0: edit-lock unlock ===")
  await page.fill(
    "input[placeholder='edit password']",
    process.env.ADMIN_EDIT_PASSWORD ?? "askmike-dev",
  )
  await page.click("button:has-text('Unlock edit')")
  await page.waitForSelector("text=Edit unlocked", { timeout: 5000 })
  console.log("edit unlocked ✓")

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

  console.log(
    "\n=== Test 9: P6 /review/[taskId] renders + approve+reopen roundtrip ===",
  )
  // Capture the first 'open →' link in the default-open queue. Stable
  // enough — even if test data shifts, the queue defaults to open status
  // and there will be at least one task as long as P4 has been run.
  const firstTaskHref = await page
    .locator("a:text-is('open →')")
    .first()
    .getAttribute("href")
  if (!firstTaskHref) throw new Error("No 'open →' link found on /review")
  await page.goto(`http://localhost:3000${firstTaskHref}`, {
    waitUntil: "networkidle",
  })
  // Title comes from review_tasks.title (e.g. "Confirm cross-check: hsbc-red · ...").
  const detailTitle = await page.locator("h1").first().textContent()
  console.log(`detail page title: ${detailTitle?.trim()}`)
  // Supporting-claims section heading is "Supporting claims (N)".
  const supportingHeading = await page
    .locator("h2:has-text('Supporting claims')")
    .first()
    .textContent()
  console.log(`supporting heading: ${supportingHeading?.trim()}`)
  // Approve via the green button, wait for the success banner. Post-B,
  // supporting-claim cards are also emerald-tinted (bg-emerald-50/30) so
  // `.border-emerald-200` alone matches multiple elements. Scope to the
  // Actions card, whose only emerald element is the result banner
  // (text-emerald-800 · bg-emerald-50 without the /30).
  await page.click("button:text-is('Approve')")
  await page.waitForSelector(
    ".rounded-lg:has(h3:has-text('Actions')) .border-emerald-200",
    { timeout: 6000 },
  )
  const approveBanner = await page
    .locator(".rounded-lg:has(h3:has-text('Actions')) .border-emerald-200")
    .first()
    .textContent()
  console.log(`approve banner: ${approveBanner?.trim().slice(0, 80)}`)
  // After approve, header status badge should say "resolved". Wait for the
  // page to revalidate before reading state (router.refresh is async).
  await page.waitForSelector("span:text-is('resolved')", { timeout: 4000 })
  const resolvedBadge = await page
    .locator("span:text-is('resolved')")
    .first()
    .isVisible()
  console.log(`task status badge shows 'resolved': ${resolvedBadge}`)
  // Reopen — restores the demo state so subsequent verify:ui runs see the
  // queue at full strength, and exercises the reopen action path.
  await page.click("button:has-text('Reopen task')")
  await page.waitForSelector(
    ".rounded-lg:has(h3:has-text('Actions')) .border-emerald-200:has-text('Reopened')",
    { timeout: 6000 },
  )
  await page.waitForSelector("span:text-is('open')", { timeout: 4000 })
  const reopenedBadge = await page
    .locator("span:text-is('open')")
    .first()
    .isVisible()
  console.log(`after reopen, status badge shows 'open': ${reopenedBadge}`)

  console.log(
    "\n=== Test 10: P7 /rules surfaces xchk__-prefixed materialized rules ===",
  )
  await page.goto("http://localhost:3000/rules", { waitUntil: "networkidle" })
  // Search the rules table for the xchk__ prefix used by the materializer.
  // Rows with this slug came from cross_check_group materialization, not
  // from hand-curated YAML.
  const searchBox = page.locator(
    "input[placeholder^='Search rule']",
  )
  await searchBox.fill("xchk")
  await page.waitForTimeout(150)
  const xchkRows = await page
    .locator("table tbody tr:has(div.font-mono:has-text('xchk__'))")
    .count()
  console.log(`/rules rows with xchk__ slug after search: ${xchkRows}`)
  // Also verify the header subtitle's total approved count includes them.
  // The hint in subtitle is "<approved> approved", grab the number that
  // precedes that literal word.
  const rulesSubtitle = await page
    .locator("div:has(> h1:text-is('Reward rules')) > div.mt-0\\.5")
    .first()
    .textContent()
  console.log(`/rules header: ${rulesSubtitle?.trim().replace(/\s+/g, " ")}`)

  console.log(
    "\n=== Test 11: P10 /dashboard Phase 2 extraction telemetry card ===",
  )
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" })
  // The new Card has CardTitle "Phase 2 — extraction + cross-check". Walk
  // from there to its CardContent and read out the LLM cost + backlog Stat.
  const phase2Card = page
    .locator(".rounded-lg:has(h3:has-text('Phase 2 — extraction'))")
    .first()
  const costStat = await phase2Card
    .locator("div:has(> div:text-is('LLM cost to date')) > div.text-xl")
    .first()
    .textContent()
  console.log(`LLM cost-to-date Stat: ${costStat?.trim()}`)
  const backlogStat = await phase2Card
    .locator("div:has(> div:text-is('Review backlog')) > div.text-xl")
    .first()
    .textContent()
  console.log(`Review backlog Stat: ${backlogStat?.trim()}`)
  // Top-cards bar list exists (means materialized rules > 0).
  const topCardsBars = await phase2Card
    .locator("h4:has-text('Top cards by materialized rules') ~ ul li")
    .count()
  console.log(`top materialized-rules bars rendered: ${topCardsBars}`)

  console.log(
    "\n=== Test 12: P10 /rules/[xchk__-slug] cross-check provenance card ===",
  )
  // Find any xchk__-prefixed rule slug via the /rules search and click it.
  await page.goto("http://localhost:3000/rules", { waitUntil: "networkidle" })
  await page
    .locator("input[placeholder^='Search rule']")
    .fill("xchk__earn_rate")
  await page.waitForTimeout(150)
  const firstXchkLink = await page
    .locator("table tbody tr:has(div.font-mono:has-text('xchk__earn_rate')) a")
    .first()
    .getAttribute("href")
  if (!firstXchkLink) throw new Error("No xchk__ earn_rate rule visible on /rules")
  await page.goto(`http://localhost:3000${firstXchkLink}`, {
    waitUntil: "networkidle",
  })
  // The provenance Card renders below the existing 6 cards. Its title is
  // "Cross-check provenance ...".
  const provCard = page
    .locator(".rounded-lg:has(h3:has-text('Cross-check provenance'))")
    .first()
  const provSupportingHeading = await provCard
    .locator("h4:has-text('Supporting sources')")
    .first()
    .textContent()
  console.log(`provenance supporting heading: ${provSupportingHeading?.trim()}`)
  // At least one supporting-source card (emerald-tinted) exists.
  const supportingClaims = await provCard
    .locator("div.bg-emerald-50\\/30 blockquote")
    .count()
  console.log(`provenance claim blockquotes rendered: ${supportingClaims}`)

  console.log("\n=== Test 13: P18 conflict picker + edit-lock ===")
  // Navigate to a review-task detail (has a group + claims) → the picker
  // renders the source versions + a manual-input radio.
  await page.goto("http://localhost:3000/review", { waitUntil: "networkidle" })
  const anyTaskHref = await page
    .locator("a:text-is('open →')")
    .first()
    .getAttribute("href")
  if (anyTaskHref) {
    await page.goto(`http://localhost:3000${anyTaskHref}`, {
      waitUntil: "networkidle",
    })
    const pickerVisible = await page
      .locator("text=Resolve conflict — pick a version")
      .first()
      .isVisible()
      .catch(() => false)
    const versionRadios = await page
      .locator("input[name='conflict-version']")
      .count()
    console.log(
      `conflict picker present: ${pickerVisible} · version options: ${versionRadios}`,
    )
  }
  // Lock edit again → the top bar flips back to "View only".
  await page.click("button:has-text('Lock')")
  await page.waitForSelector("text=View only", { timeout: 4000 })
  console.log("re-locked → View only ✓")

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
