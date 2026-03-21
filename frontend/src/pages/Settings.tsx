import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Save, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

export function Settings() {
  const { t } = useTranslation();
  const { user, updateUser } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (user) {
      setEmail(user.email || '');
    }
  }, [user]);
  const isPasswordMismatch = password !== '' && confirmPassword !== '' && password !== confirmPassword;

  const handleSave = async () => {
    setError('');
    setSuccess('');
    
    if (isPasswordMismatch) {
      setError(t('passwordsDoNotMatch'));
      return;
    }

    setIsSaving(true);
    try {
        const updateData: any = {
          email: email
        };
        
        if (password) {
          updateData.password = password;
        }

        if (user && user.id) {
            const response = await api.put<any>(`/api/v1/users/${user.id}`, updateData);
            let successMsg = t('personalSettingsSaved');
            if (password) {
              successMsg = t('personalSettingsAndPasswordSaved');
            }
            setSuccess(successMsg);
            setPassword('');
            setConfirmPassword('');
            
            // Update global state with new email
            updateUser({ email: response.email });
        }
    } catch (error: any) {
        console.error("Failed to save settings", error);
        setError(error.message || t('failedToSaveSettings'));
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-50/30 overflow-hidden">
      <div className="h-14 px-6 flex items-center justify-between border-b border-zinc-100 bg-white">
        <div className="flex items-center gap-2 text-zinc-700 font-medium">
          <Save className="h-5 w-5 text-indigo-500" />
          个人设置
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <div className="grid gap-6 max-w-2xl mx-auto">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-3">{error}</div>}
          {success && <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-md p-3">{success}</div>}
          
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl">{t('accountInfo')}</CardTitle>
              <CardDescription>{t('modifyLoginEmailAndPassword')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t('username')}</Label>
                <Input 
                  id="username" 
                  value={user?.username || ''}
                  disabled
                  className="bg-zinc-50 text-zinc-500"
                />
                <p className="text-xs text-zinc-400">{t('usernameCannotBeModified')}</p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email">{t('emailAddress')}</Label>
                <Input 
                  id="email" 
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2 pt-4 border-t border-zinc-100">
                <Label htmlFor="new-password">{t('newPassword')}</Label>
                <Input 
                  id="new-password" 
                  type="password" 
                  placeholder={t('leaveBlankIfNotModifying')} 
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">{t('confirmNewPassword')}</Label>
                <Input 
                  id="confirm-password" 
                  type="password" 
                  placeholder={t('leaveBlankIfNotModifying')} 
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError('');
                  }}
                />
                {isPasswordMismatch && <p className="text-sm text-red-600">{t('passwordsDoNotMatch')}</p>}
              </div>
            </CardContent>
            <CardFooter className="bg-zinc-50/50 border-t border-zinc-100 pt-6">
              <Button onClick={handleSave} className="ml-auto bg-indigo-600 hover:bg-indigo-700 text-white" disabled={isSaving || isPasswordMismatch}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                保存设置
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
