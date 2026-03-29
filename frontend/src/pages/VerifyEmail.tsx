import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { api } from "@/lib/api";

export function VerifyEmail() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const hasAttempted = useRef(false);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      setErrorMessage(t("verifyEmailFailed"));
      return;
    }

    if (hasAttempted.current) return;
    hasAttempted.current = true;

    const verifyToken = async () => {
      try {
        await api.get(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`);
        setStatus("success");
      } catch (err: any) {
        setStatus("error");
        setErrorMessage(err.message || t("verifyEmailFailed"));
      }
    };

    verifyToken();
  }, [searchParams, t]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/50 px-4">
      <div className="w-full max-w-md bg-background rounded-2xl shadow-xl border border-border p-8 text-center">
        <div className="mb-6 flex justify-center">
          {status === "loading" && <Loader2 className="h-16 w-16 text-indigo-600 animate-spin" />}
          {status === "success" && <CheckCircle2 className="h-16 w-16 text-emerald-500" />}
          {status === "error" && <XCircle className="h-16 w-16 text-red-500" />}
        </div>
        
        <h2 className="text-2xl font-bold text-foreground/90 mb-4">
          {t("verifyEmailTitle")}
        </h2>

        <div className="mb-8 text-muted-foreground">
          {status === "loading" && <p>{t("verifyingEmail")}</p>}
          {status === "success" && <p className="text-emerald-600 font-medium">{t("verifyEmailSuccess")}</p>}
          {status === "error" && <p className="text-red-600 font-medium">{errorMessage}</p>}
        </div>

        <Button
          onClick={() => navigate("/login")}
          className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-primary-foreground font-medium text-base rounded-xl transition-all shadow-md"
        >
          {t("goToLogin")}
        </Button>
      </div>
    </div>
  );
}
