import { auth } from "@/i18n/messages/auth-en";

export function IdentifierField() {
  return (
    <label>
      {auth.account}
      <input
        name="identifier"
        required
        autoComplete="username"
        maxLength={254}
      />
    </label>
  );
}

export function NewPasswordFields() {
  return (
    <>
      <label>
        {auth.newPassword}
        <input
          type="password"
          name="newPassword"
          autoComplete="new-password"
          aria-describedby="password-requirements"
          minLength={15}
          maxLength={256}
          required
        />
      </label>
      <p id="password-requirements" className="auth-field-help">
        {auth.passwordHelp}
      </p>
      <label>
        {auth.confirmPassword}
        <input
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          maxLength={256}
          required
        />
      </label>
    </>
  );
}

export function VerificationField() {
  return (
    <label>
      {auth.code}
      <input
        name="code"
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        required
      />
    </label>
  );
}
