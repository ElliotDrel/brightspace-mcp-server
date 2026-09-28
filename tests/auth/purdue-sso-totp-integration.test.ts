import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurdueSSOFlow } from "../../src/auth/purdue-sso.js";
import { MfaApprovalError, UnsupportedAuthenticationError, AutomaticCodeAuthenticationError } from "../../src/auth/sso-flow.js";
import { AUTH_COMMAND } from "../../src/utils/commands.js";
import { generateTotp } from "../../src/auth/totp.js";

const BASE_URL = "https://purdue.brightspace.com";
const SIGN_SELECTOR = "#idRichContext_DisplaySign";

interface PollState {
  number?: string;
  code?: boolean;
  codeMethod?: boolean;
  otherMethod?: boolean;
  account?: string;
  challenge?: boolean;
  kmsi?: boolean;
  /**
   * Microsoft's federated-domain "Do you trust <domain>?" interstitial.
   * `true` names the domain the login is actually signing into (purdue.edu,
   * matching BASE_URL below); a string names a different domain, to model
   * the browser being steered to someone else's confirmation.
   */
  trust?: boolean | string;
  url?: string;
  cookie?: boolean;
  d2l?: boolean;
}

function captureWarnings() {
  const lines: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (first.includes("[WARN]")) lines.push(first);
  });
  return lines;
}

/** A sequence of page states driven by the same two-second poll as production. */
function makeMfaPage(states: PollState[]) {
  let poll = 0;
  const yes = vi.fn(async () => {});
  const fill = vi.fn(async () => {});
  const press = vi.fn(async () => {});
  const continueClick = vi.fn(async () => {});
  const current = () => states[Math.min(poll, states.length - 1)] ?? {};
  const locatorTarget = (selector: string) => ({
    count: async () => selector === "#displayName" && current().account ? 1 : 0,
    isVisible: async () => {
      if (selector === SIGN_SELECTOR) return current().number !== undefined;
      if (selector === "#idTxtBx_SAOTCC_OTC" || selector === 'input[name="otc"]') return Boolean(current().code);
      if (selector === "#idSubmit_SAOTCC_Continue") return Boolean(current().code);
      if (selector === "#idDiv_SAOTCAS_Title" || selector === "#idDiv_SAOTCC_Title") return Boolean(current().challenge || current().code);
      if (selector === "#KmsiCheckboxField" || selector === "#idSIButton9") return Boolean(current().kmsi);
      return false;
    },
    textContent: async () => {
      if (["#displayName", "#signInName", "#userDisplayName"].includes(selector) &&
          !(selector === "#displayName" && current().account)) {
        throw new Error("Optional account labels must not be awaited when absent");
      }
      return selector === SIGN_SELECTOR ? current().number ?? null
        : selector === "#displayName" ? current().account ?? null : null;
    },
    click: yes,
    fill,
    press,
  });
  const page = {
    url: vi.fn(() => current().url ?? "https://login.microsoftonline.com/common/SAS/BeginAuth"),
    locator: vi.fn((selector: string) => ({ first: () => locatorTarget(selector) })),
    // Pattern-aware: the loop asks this for "Stay signed in?" and for the
    // federated-domain trust heading, and each belongs to a different state.
    getByText: vi.fn((pattern: RegExp) => ({ first: () => ({
      isVisible: async () =>
        /stay signed in/i.test(String(pattern))
          ? Boolean(current().kmsi)
          : /use a verification code/i.test(String(pattern))
            ? Boolean(current().codeMethod)
            : /sign in another way/i.test(String(pattern))
              ? Boolean(current().otherMethod)
          : /do you trust/i.test(String(pattern))
            ? Boolean(current().trust)
            : false,
      textContent: async () => {
        const trust = current().trust;
        if (!trust) return null;
        const domain = trust === true ? "purdue.edu" : trust;
        return `Do you trust ${domain}?\nWorking anonymously? Continue only if you trust it.`;
      },
      click: continueClick,
    }) })),
    // Only the controls the MFA loop legitimately looks for are reported
    // visible, so an unmodelled button is never clicked by accident.
    getByRole: vi.fn((role: string, query?: { name?: RegExp }) => ({ first: () => ({
      isVisible: async () =>
        role === "button" && query?.name?.test("Continue") ? Boolean(current().trust) : false,
      click: continueClick,
    }) })),
    context: vi.fn(() => ({
      cookies: vi.fn(async () => current().cookie ? [{ name: "d2lSessionVal", value: "live" }] : []),
    })),
    evaluate: vi.fn(async () => Boolean(current().d2l)),
    waitForTimeout: vi.fn(async (milliseconds: number) => {
      poll += 1;
      vi.advanceTimersByTime(milliseconds);
    }),
  };
  return { page, yes, fill, press, continueClick, poll: () => poll };
}

describe("Purdue MFA loop ported from Brightspace Bar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const handleMFA = (
    page: unknown,
    requestMfaCode?: () => Promise<string>,
    onMfaChallenge?: (number: string | null) => void,
  ): Promise<void> =>
    (new PurdueSSOFlow({ baseUrl: BASE_URL, requestMfaCode, onMfaChallenge }) as any).handleMFA(page);

  it("selects Microsoft's code method and answers it from the saved enrollment", async () => {
    const uri = "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const { page, fill, continueClick } = makeMfaPage([
      { codeMethod: true },
      { code: true, account: "alice@purdue.edu" },
      { url: `${BASE_URL}/d2l/home`, cookie: true, d2l: true },
    ]);
    await (new PurdueSSOFlow({ baseUrl: BASE_URL, username: "alice", totpUri: uri }) as any).handleMFA(page);
    expect(continueClick).toHaveBeenCalledOnce();
    expect(fill).toHaveBeenCalledWith(generateTotp(uri, Date.now() - 2000));
  });

  it("opens alternate sign-in methods before choosing verification code", async () => {
    const uri = "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const { page, fill, continueClick } = makeMfaPage([
      { otherMethod: true },
      { codeMethod: true },
      { code: true },
      { url: `${BASE_URL}/d2l/home`, cookie: true, d2l: true },
    ]);
    await (new PurdueSSOFlow({ baseUrl: BASE_URL, username: "alice", totpUri: uri }) as any).handleMFA(page);
    expect(continueClick).toHaveBeenCalledTimes(2);
    expect(fill).toHaveBeenCalledOnce();
  });

  it("keeps transient phone challenges inside automatic code recovery", async () => {
    const onMfaChallenge = vi.fn();
    const uri = "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const { page, fill } = makeMfaPage([
      { number: "42", challenge: true },
      { number: "42", challenge: true },
      { otherMethod: true, number: "42", challenge: true },
      { codeMethod: true },
      { code: true, number: "42" },
      { number: "42", challenge: true },
      { url: `${BASE_URL}/d2l/home`, cookie: true, d2l: true },
    ]);
    await (new PurdueSSOFlow({ baseUrl: BASE_URL, username: "alice", totpUri: uri, onMfaChallenge }) as any).handleMFA(page);
    expect(fill).toHaveBeenCalledOnce();
    expect(onMfaChallenge).not.toHaveBeenCalled();
  });

  it("reports automatic progress rather than inferring manual approval from a timeout", async () => {
    captureWarnings();
    const onMfaChallenge = vi.fn();
    const onAutomaticPending = vi.fn();
    const uri = "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const { page } = makeMfaPage([{ number: "42", challenge: true }]);
    await expect((new PurdueSSOFlow({ baseUrl: BASE_URL, username: "alice", totpUri: uri,
      onMfaChallenge, onAutomaticPending }) as any).handleMFA(page))
      .rejects.toBeInstanceOf(AutomaticCodeAuthenticationError);
    expect(onMfaChallenge).not.toHaveBeenCalled();
    expect(onAutomaticPending).toHaveBeenCalledOnce();
  });

  it("finishes a visible code form before opening its alternate-method link", async () => {
    const uri = "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const { page, fill, continueClick } = makeMfaPage([
      { code: true, otherMethod: true },
      { code: true, otherMethod: true },
      { url: `${BASE_URL}/d2l/home`, cookie: true, d2l: true },
    ]);
    await (new PurdueSSOFlow({ baseUrl: BASE_URL, username: "alice", totpUri: uri }) as any).handleMFA(page);
    expect(fill).toHaveBeenCalledOnce();
    expect(continueClick).not.toHaveBeenCalled();
  });

  it("keeps recovery automatic when code choices appear after the former grace period", async () => {
    const onMfaChallenge = vi.fn();
    const onAutomaticPending = vi.fn();
    const uri = "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const { page, fill } = makeMfaPage([
      ...Array.from({ length: 12 }, () => ({ number: "42", challenge: true })),
      { otherMethod: true }, { codeMethod: true }, { code: true },
      { url: `${BASE_URL}/d2l/home`, cookie: true, d2l: true },
    ]);
    await (new PurdueSSOFlow({ baseUrl: BASE_URL, username: "alice", totpUri: uri,
      onMfaChallenge, onAutomaticPending }) as any).handleMFA(page);
    expect(fill).toHaveBeenCalledOnce();
    expect(onMfaChallenge).not.toHaveBeenCalled();
    expect(onAutomaticPending).toHaveBeenCalledOnce();
  });

  it("classifies an unfinished submitted code as automatic failure rather than phone approval", async () => {
    const onMfaChallenge = vi.fn();
    const uri = "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const { page, fill } = makeMfaPage([{ code: true }]);
    await expect((new PurdueSSOFlow({ baseUrl: BASE_URL, username: "alice", totpUri: uri,
      onMfaChallenge }) as any).handleMFA(page)).rejects.toBeInstanceOf(AutomaticCodeAuthenticationError);
    expect(fill).toHaveBeenCalledOnce();
    expect(onMfaChallenge).not.toHaveBeenCalled();
  });

  it("does not submit a code when Microsoft shows another account", async () => {
    const uri = "otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const { page, fill } = makeMfaPage([{ code: true, account: "other@purdue.edu" }]);
    await expect((new PurdueSSOFlow({ baseUrl: BASE_URL, username: "alice", totpUri: uri }) as any).handleMFA(page))
      .rejects.toBeInstanceOf(UnsupportedAuthenticationError);
    expect(fill).not.toHaveBeenCalled();
  });

});
