import { Check, X } from "lucide-react";
import { evaluatePassword } from "@/lib/passwordPolicy";

interface Props {
  password: string;
  /** Only show the list once the user started typing. */
  showWhenEmpty?: boolean;
}

export default function PasswordRequirements({ password, showWhenEmpty = false }: Props) {
  if (!password && !showWhenEmpty) return null;

  const { checks } = evaluatePassword(password);

  return (
    <ul className="mt-2 space-y-1 text-xs">
      {checks.map((c) => (
        <li
          key={c.id}
          className={
            "flex items-center gap-2 " +
            (c.passed ? "text-green-600" : "text-muted-foreground")
          }
        >
          {c.passed ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <X className="w-3.5 h-3.5 text-muted-foreground/60" />
          )}
          <span>{c.label}</span>
        </li>
      ))}
    </ul>
  );
}
