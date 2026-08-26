"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, User, MapPin, Briefcase, Info } from "lucide-react";
import { CITY_OPTIONS, locateCity } from "@/lib/indiaGeo";

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState<'ARTISAN' | 'ADMIN'>('ARTISAN');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    craftType: "Ikat",
    location: "",
    experienceYears: "",
    aadhaarLast4: "",
    annualIncome: "",
    clusterName: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // The demand map can only pin a town it knows. Warn while typing rather than
  // silently registering someone who will never appear on the map.
  const locationResolves = Boolean(locateCity(formData.location));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          role,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to register");
      }

      // Success! The httpOnly cookie is set. Redirect to dashboard.
      if (role === 'ADMIN') {
        router.push("/admin/facilitator");
      } else {
        router.push("/artisan/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register");
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
          Join the Cooperative
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:text-primary-dark">
            Sign in
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md animate-fade-in-up">
        <div className="bg-white py-8 px-4 shadow-xl shadow-gray-200/50 sm:rounded-3xl sm:px-10 border border-gray-100">
          
          {/* Tabs */}
          <div className="flex bg-gray-100 p-1 rounded-xl mb-8">
            <button
              onClick={() => setRole('ARTISAN')}
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
                role === 'ARTISAN' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <User size={16} />
              Artisan
            </button>
            <button
              onClick={() => setRole('ADMIN')}
              className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
                role === 'ADMIN' ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <ShieldCheck size={16} />
              Admin
            </button>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium border border-red-100">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Full Name</label>
              <input
                name="name"
                type="text"
                required
                value={formData.name}
                onChange={handleChange}
                className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary sm:text-sm transition-all"
                placeholder="Sunita R."
              />
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
                placeholder="sunita@example.com"
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

            {role === 'ARTISAN' && (
              <div className="space-y-6 pt-4 border-t border-gray-100 mt-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-1">
                    <Briefcase size={14} /> Craft Type
                  </label>
                  <select
                    name="craftType"
                    value={formData.craftType}
                    onChange={handleChange}
                    className="block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary sm:text-sm bg-white"
                  >
                    <option value="Ikat">Ikat Weaving</option>
                    <option value="Banarasi">Banarasi Brocade</option>
                    <option value="Dhokra">Dhokra Metal Craft</option>
                    <option value="Pattachitra">Pattachitra Painting</option>
                  </select>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-1">
                      <MapPin size={14} /> Town or City
                    </label>
                    <input
                      name="location"
                      type="text"
                      required
                      list="karigari-cities"
                      autoComplete="off"
                      value={formData.location}
                      onChange={handleChange}
                      className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary sm:text-sm transition-all"
                      placeholder="Start typing, e.g. Pochampally"
                    />
                    <datalist id="karigari-cities">
                      {CITY_OPTIONS.map((city) => (
                        <option key={city} value={city} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Experience (Years)</label>
                    <input
                      name="experienceYears"
                      type="number"
                      required
                      min="0"
                      value={formData.experienceYears}
                      onChange={handleChange}
                      className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary sm:text-sm transition-all"
                      placeholder="5"
                    />
                  </div>
                </div>

                {formData.location.trim() !== "" && !locationResolves && (
                  <div className="-mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    <Info size={14} className="shrink-0 mt-0.5" />
                    <span>
                      We do not have this place on the demand map yet. Pick the nearest town from
                      the list so buyers near you can find you — a state name on its own will not
                      place a pin.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Aadhaar (Last 4)</label>
                    <input
                      name="aadhaarLast4"
                      type="text"
                      required
                      maxLength={4}
                      pattern="[0-9]{4}"
                      value={formData.aadhaarLast4}
                      onChange={handleChange}
                      className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary sm:text-sm transition-all"
                      placeholder="1234"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Annual Income (₹)</label>
                    <input
                      name="annualIncome"
                      type="number"
                      required
                      min="0"
                      value={formData.annualIncome}
                      onChange={handleChange}
                      className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary sm:text-sm transition-all"
                      placeholder="85000"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-1">
                    <User size={14} /> Link to SHG Group (Optional)
                  </label>
                  <p className="text-xs text-gray-500 mb-2">Joining an SHG allows community support while retaining individual decision power via SMS.</p>
                  <input
                    name="clusterName"
                    type="text"
                    value={formData.clusterName}
                    onChange={handleChange}
                    className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary sm:text-sm transition-all"
                    placeholder="e.g. Pochampally Weavers"
                  />
                </div>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-md text-sm font-bold text-white bg-primary hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Registering..." : `Register as ${role === 'ADMIN' ? 'Admin' : 'Artisan'}`}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
