import { connection } from "next/server";

import { OnboardingForm } from "@/components/onboarding-form";
import { USER_ID } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getProfile, type ProfileInput } from "@/lib/services/profile";

export default async function OnboardingPage() {
  await connection();
  const profile = await getProfile(await getDb(), USER_ID);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{profile ? "Your profile" : "Welcome"}</h1>
        <p className="text-sm text-muted">
          {profile
            ? "Changes apply to future sessions. Your practice history and estimates are kept."
            : "A few questions to set up your learner profile. Your self-ratings are only a starting point; practice quickly takes over."}
        </p>
      </div>
      <OnboardingForm
        initial={
          profile && {
            displayName: profile.displayName,
            examDate: profile.examDate,
            weeklyHours: profile.weeklyHours,
            preferredSessionMinutes: profile.preferredSessionMinutes as ProfileInput["preferredSessionMinutes"],
            nativeLanguages: profile.nativeLanguages,
            frenchExperience: profile.frenchExperience,
            skillConfidence: profile.skillConfidence,
          }
        }
      />
    </div>
  );
}
