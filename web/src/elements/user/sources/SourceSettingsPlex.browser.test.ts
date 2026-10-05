import "#elements/messages/MessageContainer";
import "#elements/user/sources/SourceSettingsPlex";
import type { MessageContainer } from "#elements/messages/MessageContainer";
import type { SourceSettingsPlex } from "#elements/user/sources/SourceSettingsPlex";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakePopup {
    closed: boolean;
    close: () => void;
    location: { replace: (url: string) => void };
}

let popup: FakePopup;
let messages: MessageContainer;
let interfaceRoot: HTMLElement;
let element: SourceSettingsPlex;

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

    element = document.createElement("ak-user-settings-source-plex");

    element.source = {
        configureUrl: "client-id",
        objectUid: "plex",
    } as SourceSettingsPlex["source"];

    element.allowConfiguration = true;

    document.body.append(interfaceRoot, element);
});

afterEach(() => {
    vi.restoreAllMocks();
    element.remove();
    interfaceRoot.remove();
});

function authenticate(): Promise<void> {
    return (element as unknown as { authenticateWithPlex(): Promise<void> }).authenticateWithPlex();
}

describe("ak-user-settings-source-plex", () => {
    it("closes the popup and shows an error when the pin request fails", async () => {
        stubPlex(() => {
            throw new TypeError("Failed to fetch");
        });

        // Rejecting here is what leaves an unhandled rejection behind in the
        // click handler, with the blank popup still open.
        await authenticate();

        expect(popup.close).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(messages.messages).toHaveLength(1));
        expect(messages.messages[0].message).toContain("Failed to connect source");
    });

    it("sends the popup to Plex once the pin arrives", async () => {
        stubPlex((url) => {
            if (url.pathname === "/api/v2/pins.json") {
                return Response.json({ id: 5, code: "CODE" });
            }

            if (url.pathname === "/api/v2/pins/5") {
                return Response.json({ id: 5, code: "CODE", authToken: "plex-token" });
            }

            return new Response(null, { status: 204 });
        });

        await authenticate();

        expect(popup.location.replace).toHaveBeenCalledWith(
            expect.stringMatching(/^https:\/\/app\.plex\.tv\/auth#\?clientID=client-id&code=CODE/),
        );

        await vi.waitFor(() => expect(popup.close).toHaveBeenCalledOnce());
        expect(messages.messages).toHaveLength(0);
    });
});
