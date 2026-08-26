"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, User } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<'ARTISAN' | 'ADMIN'>('ARTISAN');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to log in");
      }

      // Check if they selected the right role tab
      if (data.user.role === 'ADMIN' && role === 'ARTISAN') {
        throw new Error(`Invalid role. This account belongs to a Admin.`);
      } else if (data.user.role === 'ARTISAN' && role === 'ADMIN') {
        throw new Error(`Invalid role. This account belongs to an Artisan.`);
      }

      // Success! One ADMIN role opens both admin dashboards; land on Facilitator.
      if (data.user.role === 'ADMIN') {
        router.push("/admin/facilitator");
      } else {
        router.push("/artisan/dashboard");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-primary/20">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-6 hover:opacity-80 transition-opacity">
          <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
            <span className="text-white font-serif font-bold text-xl">K</span>
          </div>
          <span className="font-serif font-bold text-2xl tracking-tight text-gray-900">KARIGARI</span>
        </Link>
        <h2 className="mt-6 text-center text-3xl font-serif font-bold text-gray-900">
          Welcome back
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Don't have an account?{' '}
          <Link href="/register" className="font-medium text-primary hover:text-primary-dark">
            Register here
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md animate-fade-in-up">
        <div className="bg-white py-8 px-4 shadow-xl shadow-gray-200/50 sm:rounded-3xl sm:px-10 border border-gray-100">
          
          {/* Tabs */}
          <div className="flex bg-gray-100 p-1 rounded-xl mb-4">
            <button
              type="button"
              onClick={() => setRole('ARTISAN')}
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
                role === 'ARTISAN' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <User size={16} />
              Artisan
            </button>
            <button
              type="button"
              onClick={() => setRole('ADMIN')}
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
                role === 'ADMIN' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <ShieldCheck size={16} />
              Admin
            </button>
          </div>

          <div className="mb-8"></div>


          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium border border-red-100">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Language</label>
              <select
                className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary sm:text-sm transition-all bg-gray-50 text-gray-800 font-medium"
                onChange={(e) => {
                  if (typeof window !== 'undefined') {
                    localStorage.setItem('karigari_lang', e.target.value);
                  }
                }}
                defaultValue={typeof window !== 'undefined' ? (localStorage.getItem('karigari_lang') || 'en') : 'en'}
              >
                <option value="en">English</option>
                <option value="hi">हिन्दी (Hindi)</option>
                <option value="or">ଓଡ଼ିଆ (Odia)</option>
                <option value="te">తెలుగు (Telugu)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Email Address</label>
              <input
                name="email"
                type="email"
                required
                value={formData.email}
                onChange={handleChange}
                className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary sm:text-sm transition-all"
                placeholder="artisan@karigari.com"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Password</label>
              <input
                name="password"
                type="password"
                required
                value={formData.password}
                onChange={handleChange}
                className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary sm:text-sm transition-all"
                placeholder="••••••••"
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-md text-sm font-bold text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Signing in..." : `Sign in as ${role === 'ADMIN' ? 'Admin' : 'Artisan'}`}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
