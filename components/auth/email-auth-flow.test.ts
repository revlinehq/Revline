import { describe, expect, it, vi } from "vitest";
import { safeAuthRedirect, sendEmailCode, verifyEmailCode } from "./email-auth-flow";

function attempts() {
  const signIn = {
    status: "needs_first_factor" as Parameters<typeof verifyEmailCode>[0]["status"],
    create: vi.fn(async () => ({ error: null })),
    emailCode: {
      sendCode: vi.fn(async () => ({ error: null })),
      verifyCode: vi.fn(async () => ({ error: null })),
    },
  };
  const signUp = {
    status: "missing_requirements" as Parameters<typeof verifyEmailCode>[1]["status"],
    create: vi.fn(async () => ({ error: null })),
  };
  return { signIn, signUp };
}

describe("email sign-in or sign-up", () => {
  it("sends a code without first failing a sign-in for a new user", async () => {
    const { signIn } = attempts();
    await sendEmailCode(signIn, "person@example.com");
    expect(signIn.create).toHaveBeenCalledWith({
      identifier: "person@example.com", signUpIfMissing: true,
    });
    expect(signIn.emailCode.sendCode).toHaveBeenCalledExactlyOnceWith();
  });

  it("does not send email if creating the attempt fails", async () => {
    const { signIn } = attempts();
    signIn.create.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(sendEmailCode(signIn, "person@example.com")).rejects.toThrow("Unavailable");
    expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
  });

  it('surfaces an API failure before sending a code', async () => {
    const { signIn } = attempts();
    const error = new Error('Rate limited');
    signIn.create.mockResolvedValueOnce({ error: error as never });
    await expect(sendEmailCode(signIn, 'person@example.com')).rejects.toBe(error);
    expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
  });

  it('does not proceed after email delivery fails', async () => {
    const { signIn } = attempts();
    const error = new Error('Could not send code');
    signIn.emailCode.sendCode.mockResolvedValueOnce({ error: error as never });
    await expect(sendEmailCode(signIn, 'person@example.com')).rejects.toBe(error);
  });

  it("completes existing-account verification without creating a sign-up", async () => {
    const { signIn, signUp } = attempts();
    signIn.emailCode.verifyCode.mockImplementationOnce(async () => {
      signIn.status = "complete";
      return { error: null };
    });
    await expect(verifyEmailCode(signIn, signUp, "123456")).resolves.toBe("signIn");
    expect(signUp.create).not.toHaveBeenCalled();
  });

  it("transfers a verified new user without sending a second email", async () => {
    const { signIn, signUp } = attempts();
    const verified = {
      ...signIn,
      emailCode: {
        ...signIn.emailCode,
        verifyCode: vi.fn(async () => ({
          error: { code: "sign_up_if_missing_transfer" } as never,
        })),
      },
    };
    signUp.create.mockImplementationOnce(async () => {
      signUp.status = "complete";
      return { error: null };
    });
    await expect(verifyEmailCode(verified, signUp, "123456")).resolves.toBe("signUp");
    expect(signUp.create).toHaveBeenCalledWith({ transfer: true });
    expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
  });

  it("does not complete a sign-up that still requires fields", async () => {
    const { signIn, signUp } = attempts();
    const verified = {
      ...signIn,
      emailCode: {
        ...signIn.emailCode,
        verifyCode: vi.fn(async () => ({
          error: { errors: [{ code: "sign_up_if_missing_transfer" }] } as never,
        })),
      },
    };
    await expect(verifyEmailCode(verified, signUp, "123456")).rejects.toThrow("needs more information");
  });

  it("does not interpret an invalid code as permission to create a user", async () => {
    const { signIn, signUp } = attempts();
    const failure = { code: "form_code_incorrect" };
    const invalid = {
      ...signIn,
      emailCode: {
        ...signIn.emailCode,
        verifyCode: vi.fn(async () => ({ error: failure as never })),
      },
    };
    await expect(verifyEmailCode(invalid, signUp, "000000")).rejects.toBe(failure);
    expect(signUp.create).not.toHaveBeenCalled();
  });

  it("does not consume a verified code again when retrying finalization", async () => {
    const { signIn, signUp } = attempts();
    signUp.status = "complete";
    await expect(verifyEmailCode(signIn, signUp, "123456")).resolves.toBe("signUp");
    expect(signIn.emailCode.verifyCode).not.toHaveBeenCalled();
  });

  it('does not finalize an existing user needing another verification step', async () => {
    const { signIn, signUp } = attempts();
    signIn.status = 'needs_second_factor';
    await expect(verifyEmailCode(signIn, signUp, '123456')).rejects.toThrow('another verification step');
    expect(signUp.create).not.toHaveBeenCalled();
  });

  it('surfaces a failed transfer without treating a new account as complete', async () => {
    const { signIn, signUp } = attempts();
    const error = new Error('Transfer unavailable');
    signIn.emailCode.verifyCode.mockResolvedValueOnce({ error: { code: 'sign_up_if_missing_transfer' } as never });
    signUp.create.mockResolvedValueOnce({ error: error as never });
    await expect(verifyEmailCode(signIn, signUp, '123456')).rejects.toBe(error);
  });
});

describe('auth return URL', () => {
  const origin = 'https://tryrevline.com';
  it.each(['/chat?prompt=Keep%20it%20short', '/profile?source=auth#billing', 'https://tryrevline.com/editor/demo?source=auth'])('preserves an internal destination: %s', target => {
    expect(safeAuthRedirect(target, origin)).toBe(target.replace(origin, ''));
  });
  it.each([null, '', 'https://example.com/chat', '//example.com/chat', 'javascript:alert(1)', 'https://user@tryrevline.com/chat', '/sign-in', '/sign-up/verify', '/sso-callback?redirect_url=/chat'])('rejects an unsafe destination or auth loop: %s', target => {
    expect(safeAuthRedirect(target, origin)).toBe('/chat');
  });
});
