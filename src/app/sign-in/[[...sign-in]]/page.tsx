import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0e1a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "24px",
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {/* Terminal-style header */}
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "#00d4ff", fontWeight: 700, fontSize: "18px", letterSpacing: "3px" }}>
          ▮ TA TERMINAL
        </div>
        <div style={{ color: "#4a6080", fontSize: "11px", marginTop: "6px", letterSpacing: "1px" }}>
          AUTOPILOT v17.0 · AUTHORISED ACCESS ONLY
        </div>
      </div>

      {/* Clerk sign-in widget */}
      <SignIn
        appearance={{
          variables: {
            colorBackground: "#0f1629",
            colorInputBackground: "#0a0e1a",
            colorInputText: "#c8d8f0",
            colorText: "#c8d8f0",
            colorTextSecondary: "#6b85a0",
            colorPrimary: "#00d4ff",
            colorDanger: "#ff4757",
            borderRadius: "4px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "13px",
          },
          elements: {
            card: {
              border: "1px solid #1e2d4a",
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            },
            headerTitle: { color: "#c8d8f0", letterSpacing: "1px" },
            headerSubtitle: { color: "#6b85a0" },
            formButtonPrimary: {
              background: "rgba(0,212,255,0.12)",
              border: "1px solid rgba(0,212,255,0.4)",
              color: "#00d4ff",
              fontWeight: 700,
              letterSpacing: "1px",
            },
            footerActionLink: { color: "#00d4ff" },
          },
        }}
      />
    </div>
  );
}
