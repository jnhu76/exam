import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, setNavigate } from "./api";
import { downloadFile } from "./download";

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

describe("downloadFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setNavigate(() => {});
  });

  it("sends cookie credentials and triggers a blob download with the filename", async () => {
    // Provide the body as a Uint8Array, not a Blob. The vitest jsdom env
    // exposes Node/undici's global `Response`, and `new Response(blob)` runs
    // undici's extractBody. Its `webidl.is.Blob` brand check is bound to the
    // Blob in undici's module-realm (Node's global), but the Blob constructor
    // visible to this jsdom test is jsdom's realm-Blob — so a jsdom Blob fed
    // to the global Response fails the check and undici falls back to
    // `String(object)` -> "[object Blob]" (silent garbage bytes; flaky across
    // Node-bundled undici versions). The BufferSource (Uint8Array) path is
    // brand-check-free and realm-stable, so the bytes round-trip on every Node.
    const body = new TextEncoder().encode("csv");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const anchorClick = vi.fn();
    const anchorSet = vi.fn();
    const anchorEl = {
      href: "",
      download: "",
      click: anchorClick,
      set href_(v: string) {
        anchorSet(v);
      },
    } as unknown as HTMLAnchorElement;
    const createElement = vi
      .spyOn(document, "createElement")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockReturnValue(anchorEl as any);

    await downloadFile("/api/admin/attempts/abc/export/csv", "attempt-abc.csv");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/attempts/abc/export/csv",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    // Regression guard: the Blob handed to createObjectURL must preserve the
    // response body bytes ("csv"), not a cross-realm fallback like
    // "[object Blob]". Feeding the Response a Uint8Array keeps the body path
    // realm-stable so this assertion holds across Node-bundled undici versions.
    const downloadedBlob = createObjectURL.mock.calls[0]![0] as Blob;
    await expect(downloadedBlob.text()).resolves.toBe("csv");
    expect(anchorEl.download).toBe("attempt-abc.csv");
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    createElement.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("throws ApiError on non-2xx with localized message", async () => {
    const errorBody = {
      error: { code: "RESOURCE_NOT_FOUND", message: "not found" },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(errorBody), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadFile("/api/admin/attempts/x/export/csv", "x.csv"),
    ).rejects.toMatchObject({ name: "ApiError", status: 404 });
  });

  it("rethrows ApiError as-is (does not double-wrap)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await downloadFile("/api/admin/attempts/x/export/csv", "x.csv");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
    }
  });
});
