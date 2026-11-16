/**
 * International phone fields always keep a single leading "+" without inventing
 * a country code. Digits only after "+"; paste with or without "+" is accepted.
 */

const MAX_E164_DIGITS = 15;

/** Normalize editable phone input to `+` plus at most 15 digits. */
export function applyPhonePlusPrefix(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, MAX_E164_DIGITS);
  return `+${digits}`;
}

/** True when the field is only the required prefix (treated as empty). */
export function isPhonePlusPrefixOnly(value: string): boolean {
  return applyPhonePlusPrefix(value) === '+';
}

/** Empty/`+` → null; otherwise the prefixed digit string for optional fields. */
export function optionalPhonePlusPrefixValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = applyPhonePlusPrefix(value);
  return normalized === '+' ? null : normalized;
}

/**
 * Feed existing Clerk/demo normalizers that still accept bare 10-digit US numbers.
 * The field itself never invents a country code — only the cosmetic "+" prefix.
 */
export function phonePlusPrefixForLegacyNormalize(value: string): string {
  const prefixed = applyPhonePlusPrefix(value);
  const digits = prefixed.slice(1);
  if (digits.length === 10) return digits;
  return prefixed;
}

/**
 * Controlled-input helpers: keep "+" visible when empty/focused and block
 * removing the prefix. Callers keep existing validators/normalizers.
 */
export function phonePlusPrefixFieldProps(
  value: string,
  onChange: (next: string) => void,
): {
  value: string;
  onChangeText: (raw: string) => void;
  onFocus: () => void;
  keyboardType: 'phone-pad';
} {
  const display = value.length === 0 ? '+' : applyPhonePlusPrefix(value);
  return {
    value: display,
    keyboardType: 'phone-pad',
    onChangeText: (raw) => {
      onChange(applyPhonePlusPrefix(raw));
    },
    onFocus: () => {
      if (value.length === 0 || applyPhonePlusPrefix(value) !== value) {
        onChange(applyPhonePlusPrefix(value));
      }
    },
  };
}
