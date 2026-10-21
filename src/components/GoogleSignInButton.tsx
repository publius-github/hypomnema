// The "Sign in with Google" button as Google's sign-in branding
// guidelines draw it (developers.google.com/identity/branding-guidelines):
// 40px tall, the four-color "G" at 20px, 1px border, light and dark
// schemes in Google's own colors rather than the app palette, and the
// exact wording. The "G" is Google's trademark, used here under those
// guidelines and not under the app's license (TRADEMARKS.md).

const G_LOGO = (
  <svg aria-hidden viewBox="0 0 48 48" width="20" height="20" className="shrink-0">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

export default function GoogleSignInButton({
  onClick,
  disabled = false,
  busy = false,
  busyLabel = "Signing in...",
  className = "",
}: {
  onClick: () => void;
  disabled?: boolean;
  /** A sign-in is under way: the label says so and the button is inert. */
  busy?: boolean;
  busyLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      // Google's light scheme (#FFFFFF / #747775 / #1F1F1F) and dark
      // scheme (#131314 / #8E918F / #E3E3E3); the hover and press
      // states are the text color at 8% and 12%, as the guidelines
      // specify, laid over the fill
      className={`google-signin inline-flex h-10 items-center gap-2.5 rounded-sm border px-3 text-sm font-medium disabled:opacity-50 ${className}`}
    >
      {G_LOGO}
      <span>{busy ? busyLabel : "Sign in with Google"}</span>
    </button>
  );
}
