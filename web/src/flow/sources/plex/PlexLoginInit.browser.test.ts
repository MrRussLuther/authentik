import "#flow/sources/plex/PlexLoginInit";
import type { PlexLoginInit } from "#flow/sources/plex/PlexLoginInit";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PIN_KEY = "authentik-plex-pin";
const ATTEMPT_KEY = "authentik-plex-attempt";

interface NavigateEvent extends Event {
    destination: { url: string; sameDocument: boolean };
}

interface NavigationTarget extends EventTarget {
    addEventListener(type: "navigate", listener: (event: NavigateEvent) => void): void;
    removeEventListener(type: "navigate", listener: (event: NavigateEvent) => void): void;
}

const navigation = (window as unknown as { navigation: NavigationTarget }).navigation;

const startUrl = window.location.href;

let navigations: string[] = [];
const mounted: PlexLoginInit[] = [];

// Records every cross-document navigation and cancels it, so the test page is
// not navigated away from while the component under test is running.
function trapNavigation(event: NavigateEvent): void {
    if (event.destination.sameDocument) return;

    navigations.push(event.destination.url);
    event.preventDefault();
}

interface PlexBackend {
    pinStatus?: Record<string, { authToken?: string } | number>;
    redeem?: unknown;
}

function stubBackend({ pinStatus = {}, redeem }: PlexBackend = {}): void {
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
        const request = new Request(input, init);
        const { pathname } = new URL(request.url);

        if (pathname === "/api/v2/pins.json") {
            return Response.json({ id: 1001, code: "NEWCODE" });
        }

        const status = /^\/api\/v2\/pins\/(\d+)$/.exec(pathname);

        if (status) {
            const entry = pinStatus[status[1]] ?? 404;

            return typeof entry === "number"
                ? new Response("{}", { status: entry })
                : Response.json(entry);
        }

        if (pathname === "/api/v3/sources/plex/redeem_token/") {
            return Response.json(redeem);
        }

        throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    });
}

async function mountStage(host?: { challenge?: unknown }): Promise<PlexLoginInit> {
    const element = document.createElement("ak-flow-source-plex");

    element.challenge = {
        component: "ak-flow-source-plex",
        clientId: "client-id",
        slug: "plex",
    };

    if (host) {
        element.host = host as PlexLoginInit["host"];
    }

    mounted.push(element);
    document.body.append(element);

    // `firstUpdated` is async and its work outlives `updateComplete`.
    await element.updateComplete;

    await vi.waitFor(() => expect(navigations.length > 0 || element.errorMessage).toBeTruthy(), {
        timeout: 1000,
    });

    return element;
}

function forwardUrlOf(destination: string): URL {
    const hash = new URL(destination).hash;
    const params = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));

    return new URL(params.get("forwardUrl") ?? "");
}

beforeEach(() => {
    navigations = [];
    navigation.addEventListener("navigate", trapNavigation);
    window.sessionStorage.clear();
    window.history.replaceState(null, "", startUrl);
});

afterEach(() => {
    navigation.removeEventListener("navigate", trapNavigation);
    vi.restoreAllMocks();

    for (const element of mounted.splice(0)) element.remove();

    window.sessionStorage.clear();
    window.history.replaceState(null, "", startUrl);
});

describe("ak-flow-source-plex", () => {
    it("redirects to Plex on a fresh sign-in", async () => {
        stubBackend();

        const element = await mountStage();

        expect(element.errorMessage).toBeUndefined();
        expect(navigations).toHaveLength(1);
        expect(navigations[0]).toMatch(/^https:\/\/app\.plex\.tv\/auth#\?/);
        expect(window.sessionStorage.getItem(PIN_KEY)).toBe("1001");
    });

    it("tells Plex to forward back to a URL marked as a return", async () => {
        stubBackend();
        window.history.replaceState(null, "", "/if/flow/plex-login/?next=%2Fapp%2F");

        await mountStage();

        const forwardUrl = forwardUrlOf(navigations[0]);

        expect(forwardUrl.pathname).toBe("/if/flow/plex-login/");
        expect(forwardUrl.searchParams.get("next")).toBe("/app/");
        expect(forwardUrl.searchParams.get("plex_return")).toBe("1");
    });

    it("starts over instead of failing when the stored pin is left from an abandoned attempt", async () => {
        // The user reached Plex, left without Plex forwarding back, and is now
        // starting a fresh sign-in in the same tab. Plex has forgotten pin 999.
        stubBackend({ pinStatus: { "999": 404 } });
        window.sessionStorage.setItem(PIN_KEY, "999");
        window.sessionStorage.setItem(ATTEMPT_KEY, "1");

        const element = await mountStage();

        expect(element.errorMessage).toBeUndefined();
        expect(navigations).toHaveLength(1);
        expect(navigations[0]).toMatch(/^https:\/\/app\.plex\.tv\/auth#\?/);
        expect(window.sessionStorage.getItem(PIN_KEY)).toBe("1001");
    });

    it("completes a genuine return and strips the marker from the address bar", async () => {
        stubBackend({
            pinStatus: { "1000": { authToken: "plex-token" } },
            redeem: { component: "xak-flow-redirect", to: "/if/flow/default-source-auth/" },
        });

        window.history.replaceState(null, "", "/if/flow/plex-login/?next=%2Fapp%2F&plex_return=1");
        window.sessionStorage.setItem(PIN_KEY, "1000");

        await mountStage();

        expect(navigations).toEqual([`${window.location.origin}/if/flow/default-source-auth/`]);
        expect(window.sessionStorage.getItem(PIN_KEY)).toBeNull();
        expect(window.location.search).toBe("?next=%2Fapp%2F");
    });

    it("reports a cancelled sign-in when it is a genuine return without a token", async () => {
        stubBackend({ pinStatus: { "1000": {} } });
        window.history.replaceState(null, "", "/if/flow/plex-login/?plex_return=1");
        window.sessionStorage.setItem(PIN_KEY, "1000");

        const element = await mountStage();

        expect(element.errorMessage).toBe("Sign-in with Plex was cancelled or timed out.");
        expect(navigations).toHaveLength(0);
    });
});
