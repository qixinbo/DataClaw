import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Languages } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Login() {
  const { t, i18n } = useTranslation();
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);

  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (isLogin) {
        // Handle Login using application/x-www-form-urlencoded as required by OAuth2PasswordRequestForm
        const params = new URLSearchParams();
        params.append("username", formData.username);
        params.append("password", formData.password);

        const response = await fetch("/api/v1/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params,
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.detail || "Login failed");
        }

        const data = await response.json();
        login(data.user, data.access_token);
        navigate("/");
      } else {
        // Handle Registration
        await api.post("/api/v1/auth/register", {
          username: formData.username,
          email: formData.email,
          password: formData.password,
        });
        
        // Auto login after successful registration
        setIsLogin(true);
        setError(t("registrationSuccess"));
      }
    } catch (err: any) {
      setError(err.message || t("errorOccurred"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center flex flex-col items-center gap-4 select-none relative">
          <div className="text-[56px] leading-none animate-bounce-slow pb-2">
            🦞
          </div>
          <h1 className="text-[40px] font-bold bg-clip-text text-transparent bg-gradient-to-r from-red-500 via-orange-500 to-amber-500 tracking-tight">
            DataClaw
          </h1>
          <div className="absolute right-0 bottom-0 translate-y-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full bg-white/50 backdrop-blur-sm shadow-sm border border-zinc-200/50 text-zinc-500 hover:text-zinc-900 hover:bg-white transition-all">
                  <Languages className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                <DropdownMenuItem onClick={() => i18n.changeLanguage('zh')} className={i18n.language === 'zh' ? 'bg-zinc-100' : ''}>
                  简体中文
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => i18n.changeLanguage('en')} className={i18n.language === 'en' ? 'bg-zinc-100' : ''}>
                  English
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-zinc-100 p-8">
          <h2 className="text-2xl font-bold text-zinc-800 mb-6 text-center">
            {isLogin ? t("welcomeBack") : t("createAccount")}
          </h2>

          {error && (
            <div className={`p-3 rounded-lg mb-6 text-sm ${error.includes(t("registrationSuccess")) ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username">{t("username")}</Label>
              <Input
                id="username"
                type="text"
                placeholder={t("enterUsername")}
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
                className="h-11"
              />
            </div>

            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="email">{t("email")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("enterEmail")}
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  className="h-11"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t("enterPassword")}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                className="h-11"
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading || !formData.username || !formData.password || (!isLogin && !formData.email)}
              className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-base rounded-xl transition-all shadow-md"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                isLogin ? t("signIn") : t("signUp")
              )}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-zinc-500">
            {isLogin ? t("dontHaveAccount") : t("alreadyHaveAccount")}
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setError("");
              }}
              className="ml-2 font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
            >
              {isLogin ? t("signUp") : t("signIn")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}