import { expect, test, type Locator, type Page } from "@playwright/test";

import { ALL_BANK } from "../../src/lib/content/exercise-bank";

/** Look up the bank answer for a displayed prompt (the mock provider serves bank items). */
function bankAnswer(prompt: string): string | null {
  const item = ALL_BANK.find((b) => b.content.prompt === prompt.trim());
  if (!item) return null;
  if ("acceptedAnswers" in item.content) return item.content.acceptedAnswers[0];
  if (item.content.type === "reading_mcq") return String(item.content.correctOption);
  return null;
}

async function answerCard(card: Locator, value: string) {
  const type = await card.getAttribute("data-type");
  if (type === "reading_mcq") {
    await card.getByRole("radio").nth(Number(value)).check();
  } else {
    await card.getByLabel("Your answer").fill(value);
  }
  await card.getByRole("button", { name: /^Submit/ }).click();
  await expect(card.getByTestId("feedback").or(card.getByText("Reflection saved."))).toBeVisible();
}

test.describe.serial("learning loop in the browser", () => {
  test("onboarding creates a profile and lands on the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByTestId("provider-badge")).toHaveText("Mock AI mode");
    await page.getByLabel("Name").fill("Camille");
    await page.getByLabel(/exam date/).fill("2026-12-15");
    await page.getByLabel("Native and working languages").fill("Mandarin, English");
    await page.getByLabel("French experience").fill("Evening classes");
    await page.getByRole("button", { name: "Create my profile" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Bonjour, Camille" })).toBeVisible();
    await expect(page.getByTestId("due-count")).toHaveText("0");
    await expect(page.getByText("Not measured yet").first()).toBeVisible();
  });

  test("a 30-minute session runs end to end", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("radio", { name: "30 min" }).click();
    await page.getByRole("button", { name: "Start today's session" }).click();
    await expect(page).toHaveURL(/\/session\//);
    await expect(page.getByRole("heading", { name: "30-minute session" })).toBeVisible();
    await expect(page.locator('[data-block="targeted_drill"]')).toBeVisible();
    await expect(page.locator('[data-block="writing"]')).toBeVisible();

    const cards = page.getByTestId("exercise");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(5);
    let wrongDone = false;

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const type = (await card.getAttribute("data-type"))!;
      const prompt = (await card.getByTestId("prompt").textContent())!;

      if (type === "short_writing") {
        const min = Number((await card.textContent())!.match(/(\d+)–\d+ words/)![1]);
        const filler = Array.from({ length: min }, () => "beaucoup").join(" ");
        const text = `Samedi, je suis travaillé au bureau. ${filler}.`;
        await card.getByLabel("Your answer").fill(text);
        await expect(card.getByTestId("word-count")).toContainText(`${min + 6} words`);
        await card.getByRole("button", { name: "Submit" }).click();
        // Self-correction: the error is pointed out with a hint, the correction is withheld.
        await expect(card.getByRole("button", { name: "Show corrections" })).toBeVisible();
        await expect(card.getByTestId("verdict")).toHaveText("1 thing to fix");
        await expect(card.getByText("Hint:", { exact: false })).toBeVisible();
        await expect(card.getByText("j'ai travaillé")).toHaveCount(0);
        await card.getByLabel("Your answer").fill(text.replace("je suis travaillé", "j'ai travaillé"));
        await card.getByRole("button", { name: "Submit revision" }).click();
        await expect(card.getByTestId("verdict")).toHaveText("No language errors found");
        await expect(card.getByText("Revision", { exact: true })).toBeVisible();
        continue;
      }
      if (type === "reflection") {
        await answerCard(card, "J'ai appris le passé composé aujourd'hui.");
        continue;
      }

      const answer = bankAnswer(prompt);
      if (!wrongDone && type !== "reading_mcq") {
        await answerCard(card, "je ne sais pas");
        await expect(card.getByTestId("verdict")).toHaveText("Not quite");
        await expect(card.getByText("Expected:")).toBeVisible();
        wrongDone = true;
      } else {
        expect(answer, `bank answer for "${prompt}"`).not.toBeNull();
        await answerCard(card, answer!);
        await expect(card.getByTestId("verdict")).toHaveText("Correct");
      }
      await expect(card).toHaveAttribute("data-status", "done");
    }

    await expect(page.getByTestId("session-complete")).toBeVisible();
    await expect(page.getByTestId("progress")).toHaveText(`${count}/${count} done`);
  });

  test("mistakes appear in the error library", async ({ page }) => {
    await page.goto("/errors");
    const rows = page.getByTestId("error-row");
    await expect(rows).toHaveCount(2);
    await expect(page.getByText("je suis travaillé", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Mastered" }).click();
    await expect(page.getByText("No errors here yet.")).toBeVisible();
  });

  test("due corrections can be reviewed", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("due-count")).toHaveText("2");
    await page.getByRole("link", { name: "Review now" }).click();
    await expect(page).toHaveURL(/\/reviews$/);

    for (let i = 0; i < 2; i++) {
      const card = page.getByTestId("review");
      const prompt = (await card.getByTestId("prompt").textContent())!;
      if (prompt.includes("je suis travaillé")) {
        await card.getByLabel("Your answer").fill(prompt.replace("je suis travaillé", "j'ai travaillé"));
        await card.getByRole("button", { name: "Check" }).click();
        await expect(card.getByTestId("verdict")).toHaveText("Correct");
      } else {
        // The failed drill item is retried as the original exercise.
        await expect(card.getByText(/You got this wrong before/)).toBeVisible();
        await card.getByLabel("Your answer").fill("je ne sais toujours pas");
        await card.getByRole("button", { name: "Check" }).click();
        await expect(card.getByTestId("verdict")).toHaveText("Not quite");
      }
      await expect(card.getByText("Correct form:")).toBeVisible();
      await expect(card.getByText(/Next review in/)).toBeVisible();
      await page.getByRole("button", { name: /^(Next|Finish)$/ }).click();
    }
    await expect(page.getByTestId("reviews-empty")).toContainText("All caught up.");
  });

  test("progress shows estimates with ranges and AI telemetry", async ({ page }) => {
    await page.goto("/progress");
    await expect(page.getByRole("heading", { name: "Progress" })).toBeVisible();
    await expect(page.getByTestId("concept-row").first()).toBeVisible();
    await expect(page.getByTestId("telemetry-row").filter({ hasText: "Response analysis" })).toBeVisible();
    await expect(page.getByTestId("telemetry-row").filter({ hasText: "Exercise generation" })).toBeVisible();
  });

  test("the profile can be edited without losing progress", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveValue("Camille");
    await page.getByLabel("Name").fill("Camille L.");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("heading", { name: "Bonjour, Camille L." })).toBeVisible();
    await page.goto("/progress");
    await expect(page.getByText("Sessions completed").locator("..")).toContainText("1");
  });

  test("a session can be ended early and replaced", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("radio", { name: "15 min" }).click();
    await page.getByRole("button", { name: "Start today's session" }).click();
    await expect(page.getByRole("heading", { name: "15-minute session" })).toBeVisible();
    await page.getByRole("button", { name: "End session early" }).click();
    await expect(page.getByText("This session was ended early.")).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Start today's session" })).toBeVisible();
  });
});

test("layout works on a phone-width screen", async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/progress");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
