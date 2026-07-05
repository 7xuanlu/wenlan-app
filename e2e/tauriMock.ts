// SPDX-License-Identifier: AGPL-3.0-only
import type { Page } from "@playwright/test";
import { APP_LOCALE_STORAGE_KEY, type AppLocale } from "../src/i18n/locales";

type InstallTauriMockOptions = {
  locale: AppLocale;
  rawActions: string[];
};

export async function installTauriMock(page: Page, options: InstallTauriMockOptions): Promise<void> {
  await page.addInitScript(({ locale, rawActions, localeStorageKey }) => {
    const nowMs = Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);
    const callbacks = new Map<number, (...args: unknown[]) => unknown>();
    let nextCallbackId = 1;

    window.localStorage.setItem(localeStorageKey, locale);
    window.localStorage.setItem(
      "sidebar:spacesCollapsed",
      JSON.stringify({ value: false, ts: nowMs }),
    );

    const activityRows = rawActions.map((action, index) => ({
      id: index + 1,
      timestamp: nowSeconds - index * 60,
      agent_name: "claude-code",
      action,
      memory_ids: null,
      query: null,
      detail: null,
      memory_titles: [],
    }));

    const memoryStats = {
      total: 0,
      by_type: {},
      by_domain: {},
      recent_count: 0,
    };

    const homeStats = {
      total: 0,
      new_today: 0,
      confirmed: 0,
      total_ingested: 0,
      active_insights: 0,
      distilled_today: 0,
      distilled_all: 0,
      sources_archived: 0,
      times_served_today: 0,
      words_saved_today: 0,
      times_served_week: 0,
      words_saved_week: 0,
      times_served_all: 0,
      words_saved_all: 0,
      corrections_active: 0,
      top_memories: [],
    };

    const spaces = [
      {
        id: "space-work",
        name: "Work",
        description: null,
        suggested: false,
        starred: false,
        sort_order: 0,
        memory_count: 0,
        entity_count: 0,
        created_at: nowMs,
        updated_at: nowMs,
      },
    ];

    const agents = [
      {
        id: "agent-claude-code",
        name: "claude-code",
        display_name: "Claude Code",
        agent_type: "claude-code",
        description: null,
        enabled: true,
        trust_level: "full",
        last_seen_at: nowMs,
        memory_count: 0,
        created_at: nowMs,
        updated_at: nowMs,
      },
    ];

    const invoke = async (command: string): Promise<unknown> => {
      if (command.startsWith("plugin:")) return null;

      switch (command) {
        case "should_show_wizard":
          return false;
        case "get_clipboard_enabled":
          return false;
        case "set_traffic_lights_visible":
        case "set_setup_completed":
          return null;
        case "list_agent_activity":
          return activityRows;
        case "list_agents":
          return agents;
        case "list_spaces":
          return spaces;
        case "list_pages":
        case "search_pages":
        case "list_memories_cmd":
        case "search_entities_cmd":
        case "list_recent_retrievals":
        case "list_recent_changes":
        case "list_recent_memories":
        case "list_unconfirmed_memories":
        case "list_recent_pages":
        case "list_recent_relations":
        case "list_onboarding_milestones":
        case "list_pending_revisions":
        case "get_entity_suggestions_cmd":
          return [];
        case "get_memory_stats_cmd":
          return memoryStats;
        case "get_home_stats":
          return homeStats;
        case "get_profile":
          return null;
        case "get_briefing":
          return {
            content: "",
            new_today: 0,
            primary_agent: null,
            generated_at: nowMs,
            is_stale: false,
          };
        case "get_pending_contradictions":
          return [];
        default:
          return null;
      }
    };

    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      invoke,
      transformCallback: (callback: (...args: unknown[]) => unknown) => {
        const id = nextCallbackId++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number) => {
        callbacks.delete(id);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
  }, {
    locale: options.locale,
    rawActions: options.rawActions,
    localeStorageKey: APP_LOCALE_STORAGE_KEY,
  });
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      metadata: {
        currentWindow: { label: string };
        currentWebview: { label: string };
      };
      invoke: (command: string, args?: unknown, options?: unknown) => Promise<unknown>;
      transformCallback: (callback: (...args: unknown[]) => unknown, once?: boolean) => number;
      unregisterCallback: (id: number) => void;
    };
    __TAURI_EVENT_PLUGIN_INTERNALS__?: {
      unregisterListener: (event: string, eventId: number) => void;
    };
  }
}
