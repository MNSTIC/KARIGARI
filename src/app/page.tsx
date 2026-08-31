"use client";

import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, ShieldCheck, HandCoins, Building2, TrendingUp, CheckCircle2 } from 'lucide-react';
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { useLanguage } from "@/lib/translations";

export default function LandingPage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Navigation */}
      <nav className="fixed w-full z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* gap + shrink-0: on a phone the wordmark used to run straight into
              "Login" and push the register pill off the right edge. */}
          <div className="flex justify-between items-center h-20 gap-3">
            <div className="shrink-0">
              <KarigariLogo variant="dark" showWordmark={true} size={32} />
            </div>
            
            <div className="hidden md:flex space-x-8 items-center">
              <Link href="/" className="text-gray-600 hover:text-primary transition-colors font-medium">{t('nav_home')}</Link>
              <Link href="/buyer" className="text-gray-600 hover:text-primary transition-colors font-medium">{t('nav_buyer')}</Link>
              <Link href="/marketplace" className="text-gray-600 hover:text-primary transition-colors font-medium">{t('nav_marketplace')}</Link>
              <Link href="/login" className="text-gray-600 hover:text-primary transition-colors font-medium">{t('nav_for_artisans')}</Link>
              <Link href="/login?role=admin" className="text-gray-600 hover:text-primary transition-colors font-medium">{t('nav_for_admins')}</Link>
            </div>

            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              {/* A visitor must be able to pick their language before they log in. */}
              <LanguageSwitcher />
              <Link
                href="/login"
                className="text-primary font-medium hover:text-primary-dark transition-colors whitespace-nowrap"
              >
                {t('login')}
              </Link>
              <Link
                href="/register"
                className="bg-primary hover:bg-primary-dark text-white text-sm sm:text-base px-4 sm:px-6 py-2 sm:py-2.5 rounded-full font-medium whitespace-nowrap transition-all shadow-soft hover:shadow-lg transform hover:-translate-y-0.5"
              >
                <span className="sm:hidden">{t('register_short')}</span>
                <span className="hidden sm:inline">{t('register_as_artisan')}</span>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-grow pt-32 pb-20 lg:pt-40 lg:pb-28 overflow-hidden relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
            
            {/* Left side text */}
            <div className="max-w-xl">
              <h1 className="text-5xl lg:text-7xl font-serif font-extrabold text-gray-900 leading-[1.1] tracking-tight mb-6 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
                {t('hero_line_1')}<br/>
                <span className="text-primary">{t('hero_line_2')}</span><br/>
                {t('hero_line_3')}
              </h1>
              
              <p className="text-xl text-gray-600 mb-8 leading-relaxed animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
                {t('hero_subtitle')}
              </p>
              
              {/* Two CTAs, not three: admin sign-in is an internal door and sits
                  below as a quiet link, so the hero reads consumer -> artisan. */}
              <div className="animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                  <Link
                    href="/marketplace"
                    className="bg-primary hover:bg-primary-dark text-white px-8 py-4 rounded-full font-semibold text-lg whitespace-nowrap transition-all shadow-soft hover:shadow-lg hover:-translate-y-0.5 flex items-center justify-center gap-2 group"
                  >
                    {t('explore_marketplace')}
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </Link>
                  <Link
                    href="/login"
                    className="bg-white hover:bg-gray-50 text-gray-800 border-2 border-gray-200 hover:border-gray-300 px-8 py-4 rounded-full font-semibold text-lg whitespace-nowrap transition-all shadow-soft flex items-center justify-center"
                  >
                    {t('nav_for_artisans')}
                  </Link>
                </div>

                <Link
                  href="/login?role=admin"
                  className="inline-flex items-center gap-1.5 mt-5 text-sm font-medium text-gray-500 hover:text-primary transition-colors"
                >
                  {t('admin_signin_link')}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            {/* Right side Image & Floating Card */}
            <div className="relative lg:h-[600px] w-full flex items-center justify-center animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
              {/* Background decorative blob */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-gradient-to-tr from-primary/10 to-transparent rounded-full blur-3xl -z-10" />

              {/* The photo and its card share one positioning context. Anchoring
                  the card to the column instead let it drift left across the
                  headline copy, because the column is wider than the photo. */}
              <div className="relative w-full max-w-lg">
                <div className="relative w-full aspect-[4/5] rounded-3xl overflow-hidden shadow-2xl ring-1 ring-black/5">
                  <Image
                    src="/female_artisan.jpg"
                    alt="Female Indian artisan weaving an Ikat Silk Saree"
                    fill
                    className="object-cover hover:scale-105 transition-transform duration-1000"
                    priority
                  />
                </div>

                {/* Floating Glassmorphism Card */}
                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:-bottom-6 sm:-left-6 lg:bottom-10 lg:-left-10 bg-white/80 backdrop-blur-xl border border-white/50 p-5 sm:p-6 rounded-2xl shadow-xl w-[17rem] sm:w-80 transform transition-transform hover:-translate-y-2">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-gray-900">Ikat Silk Saree</h3>
                      <p className="text-sm text-gray-500">Pochampally</p>
                    </div>
                    <div className="bg-green-100 text-green-700 px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1">
                      <CheckCircle2 size={12} />
                      Verified
                    </div>
                  </div>
                
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500">{t('fair_wage_floor')}</span>
                      <span className="font-bold text-gray-900">₹7,100</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500">{t('market_price_band')}</span>
                      <span className="font-bold text-gray-900">₹8,800 - ₹11,200</span>
                    </div>
                  
                    <div className="pt-3 mt-3 border-t border-gray-200/50">
                      <div className="flex items-center gap-2">
                        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                          <div className="bg-green-500 h-2 rounded-full w-[85%]"></div>
                        </div>
                        <span className="text-xs font-bold text-green-600 whitespace-nowrap">Score: Low (A)</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">{t('credit_risk_assessment')}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* Footer Stats Banner */}
      <div className="bg-primary text-white py-12 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 divide-x divide-white/20">
            
            <div className="flex flex-col items-center justify-center px-4 text-center">
              <div className="bg-white/10 p-3 rounded-xl mb-4">
                <TrendingUp className="w-6 h-6 text-green-300" />
              </div>
              <h4 className="text-3xl font-bold mb-1">25K+</h4>
              <p className="text-primary-light font-medium text-sm">{t('stat_artisans_onboarded')}</p>
            </div>
            
            <div className="flex flex-col items-center justify-center px-4 text-center">
              <div className="bg-white/10 p-3 rounded-xl mb-4">
                <ShieldCheck className="w-6 h-6 text-green-300" />
              </div>
              <h4 className="text-3xl font-bold mb-1">1.2L+</h4>
              <p className="text-primary-light font-medium text-sm">{t('stat_items_verified')}</p>
            </div>
            
            <div className="flex flex-col items-center justify-center px-4 text-center">
              <div className="bg-white/10 p-3 rounded-xl mb-4">
                <HandCoins className="w-6 h-6 text-green-300" />
              </div>
              <h4 className="text-3xl font-bold mb-1">₹48Cr+</h4>
              <p className="text-primary-light font-medium text-sm">{t('stat_fair_pay')}</p>
            </div>
            
            <div className="flex flex-col items-center justify-center px-4 text-center">
              <div className="bg-white/10 p-3 rounded-xl mb-4">
                <Building2 className="w-6 h-6 text-green-300" />
              </div>
              <h4 className="text-3xl font-bold mb-1">200+</h4>
              <p className="text-primary-light font-medium text-sm">{t('stat_cooperatives')}</p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
