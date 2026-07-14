// SPDX-License-Identifier: AGPL-3.0-only
import ActiveIntelligenceStrip from "../../../intelligence/ActiveIntelligenceStrip";
import AnyProviderCard from "../../../intelligence/AnyProviderCard";
import { OnDeviceModelCard, useApiKeyStatus } from "../../../intelligence/IntelligenceSetup";

export default function IntelligenceSection({ delay }: { delay: number }) {
  const { isConfigured } = useApiKeyStatus();

  // No SectionHeader: the page h1 already says "Intelligence", and this group
  // is a single stack of cards — a repeated eyebrow would only add noise.
  return (
    <section className="mem-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex flex-col gap-3">
        <ActiveIntelligenceStrip />
        {!isConfigured && (
          <div className="mem-fade-up" style={{ animationDelay: `${delay + 30}ms` }}>
            <OnDeviceModelCard />
          </div>
        )}
        <AnyProviderCard />
      </div>
    </section>
  );
}
