import "#admin/sources/plex/PlexSourceForm";
import "#elements/messages/MessageContainer";
import type { MessageContainer } from "#elements/messages/MessageContainer";

import type { PlexSourceForm } from "#admin/sources/plex/PlexSourceForm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakePopup {
    closed: boolean;
    close: () => void;
    location: { replace: (url: string) => void };
}

let popup: FakePopup;
let messages: MessageContainer;
let interfaceRoot: HTMLElement;
let form: PlexSourceForm;

function stubPlex(handler: (url: URL) => Response | Promise<Response>): void {
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
        const request = new Request(input, init);

        return handler(new URL(request.url));
    });
}

beforeEach(() => {
    popup = {
        closed: false,
        close: vi.fn(() => {
            popup.closed = true;
        }),
        location: { replace: vi.fn() },
    };

    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    // `showMessage` looks messages up through the interface root.
    interfaceRoot = document.createElement("div");
    interfaceRoot.id = "interface-root";
    Object.assign(interfaceRoot, { renderRoot: interfaceRoot });

    messages = document.createElement("ak-message-container");
    interfaceRoot.append(messages);
    document.body.append(interfaceRoot);

    form = document.createElement("ak-source-plex-form");
    form.instance = { clientId: "client-id" } as PlexSourceForm["instance"];
});

afterEach(() => {
    vi.restoreAllMocks();
    interfaceRoot.remove();
});

describe("ak-source-plex-form", () => {
    it("closes the popup and shows an error when the pin request fails", async () => {
        stubPlex(() => {
            throw new TypeError("Failed to fetch");
        });

        // Rejecting here is what leaves an unhandled rejection behind in the
        // click handler, with the blank popup still open.
        await form.doAuth();

        expect(popup.close).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(messages.messages).toHaveLength(1));
    });

    it("sends the popup to Plex and keeps the token once the pin is authorized", async () => {
        stubPlex((url) => {
            if (url.pathname === "/api/v2/pins.json") {
                return Response.json({ id: 5, code: "CODE" });
            }

            if (url.pathname === "/api/v2/pins/5") {
                return Response.json({ id: 5, code: "CODE", authToken: "plex-token" });
            }

            return Response.json([]);
        });

        await form.doAuth();

        expect(popup.location.replace).toHaveBeenCalledWith(
            expect.stringMatching(/^https:\/\/app\.plex\.tv\/auth#\?clientID=client-id&code=CODE/),
        );

        await vi.waitFor(() => expect(form.plexToken).toBe("plex-token"));
        expect(popup.close).toHaveBeenCalledOnce();
        expect(messages.messages).toHaveLength(0);
    });
});
