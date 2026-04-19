// Password policy rules for AluminIA.
// Centralizes validation so Login / Signup / ResetPassword / ChangePassword
// all enforce the same rules.

export interface PasswordCheck {
  id: string;
  label: string;
  passed: boolean;
}

export interface PasswordEvaluation {
  checks: PasswordCheck[];
  valid: boolean;
  firstFailureMessage: string | null;
}

export const PASSWORD_RULES: Array<{
  id: string;
  label: string;
  test: (value: string) => boolean;
}> = [
  {
    id: "length",
    label: "Mínimo 8 caracteres",
    test: (v) => v.length >= 8,
  },
  {
    id: "uppercase",
    label: "Al menos 1 letra mayúscula (A-Z)",
    test: (v) => /[A-Z]/.test(v),
  },
  {
    id: "lowercase",
    label: "Al menos 1 letra minúscula (a-z)",
    test: (v) => /[a-z]/.test(v),
  },
  {
    id: "number",
    label: "Al menos 1 número (0-9)",
    test: (v) => /[0-9]/.test(v),
  },
  {
    id: "special",
    label: "Al menos 1 carácter especial (!@#$%^&*...)",
    test: (v) => /[^A-Za-z0-9]/.test(v),
  },
];

export function evaluatePassword(value: string): PasswordEvaluation {
  const checks: PasswordCheck[] = PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    passed: rule.test(value),
  }));

  const valid = checks.every((c) => c.passed);
  const firstFailure = checks.find((c) => !c.passed);

  return {
    checks,
    valid,
    firstFailureMessage: firstFailure ? firstFailure.label : null,
  };
}

// Translate Supabase auth password errors to Spanish with actionable guidance.
export function translatePasswordError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("weak") || lower.includes("easy to guess") || lower.includes("pwned")) {
    return "Esta contraseña es muy común o apareció en filtraciones. Elige una diferente.";
  }
  if (lower.includes("should be at least") || lower.includes("at least 6 characters")) {
    return "La contraseña no cumple con la longitud mínima requerida.";
  }
  if (lower.includes("same as the old password") || lower.includes("new password should be different")) {
    return "La nueva contraseña no puede ser igual a la anterior.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "Demasiados intentos. Espera un momento antes de volver a intentar.";
  }
  return message;
}
