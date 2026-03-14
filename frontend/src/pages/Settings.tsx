import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Save, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

export function Settings() {
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
      setError("两次输入的密码不一致");
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
            let successMsg = "个人设置保存成功！";
            if (password) {
              successMsg = "个人设置及密码修改成功！";
            }
            setSuccess(successMsg);
            setPassword('');
            setConfirmPassword('');
            
            // Update global state with new email
            updateUser({ email: response.email });
        }
    } catch (error: any) {
        console.error("Failed to save settings", error);
        setError(error.message || "保存设置失败");
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
              <CardTitle className="text-xl">账号信息</CardTitle>
              <CardDescription>修改您的登录邮箱和密码</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input 
                  id="username" 
                  value={user?.username || ''}
                  disabled
                  className="bg-zinc-50 text-zinc-500"
                />
                <p className="text-xs text-zinc-400">用户名不可修改</p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email">邮箱地址</Label>
                <Input 
                  id="email" 
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2 pt-4 border-t border-zinc-100">
                <Label htmlFor="new-password">新密码</Label>
                <Input 
                  id="new-password" 
                  type="password" 
                  placeholder="如不修改请留空" 
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">确认新密码</Label>
                <Input 
                  id="confirm-password" 
                  type="password" 
                  placeholder="如不修改请留空" 
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError('');
                  }}
                />
                {isPasswordMismatch && <p className="text-sm text-red-600">两次输入的密码不一致</p>}
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
