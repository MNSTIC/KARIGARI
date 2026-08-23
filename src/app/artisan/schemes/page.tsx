"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock, Award, FileText, ChevronRight, UserCheck, ShieldCheck, X } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { KarigariLogo } from "@/components/ui/KarigariLogo";
import { useRouter } from "next/navigation";

export default function SchemesPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newlyApplied, setNewlyApplied] = useState<number[]>([]);
  
  const [simulatingScheme, setSimulatingScheme] = useState<any>(null);
  const [simStep, setSimStep] = useState(0);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/artisan/dashboard');
      const data = await res.json();
      if (data.success) {
        setProfile(data.data.artisanProfile);
        setApplications(data.data.schemeApplications || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const allSchemes = [
    {
      id: 1,
      name: language === "or" ? "ପିଏମ୍ ବିଶ୍ୱକର୍ମା ଯୋଜନା" : language === "hi" ? "पीएम विश्वकर्मा योजना" : "PM Vishwakarma Yojana",
      description: language === "or" ? "ପାରମ୍ପାରିକ କାରିଗରମାନଙ୍କ ପାଇଁ ଦକ୍ଷତା ବିକାଶ, ଟୁଲକିଟ୍ ପ୍ରୋତ୍ସାହନ (₹୧୫,୦୦୦) ଏବଂ କ୍ରେଡିଟ୍ ସମର୍ଥନ।" : language === "hi" ? "पारंपरिक कारीगरों के लिए कौशल उन्नयन, टूलकिट प्रोत्साहन (₹15,000) और क्रेडिट समर्थन।" : "Skill upgradation, toolkit incentive (₹15,000) and credit support for traditional artisans.",
      amount: "₹15,000",
      incomeLimit: 200000,
      icon: <Award className="text-orange-500" size={24} />
    },
    {
      id: 2,
      name: language === "or" ? "ଜାତୀୟ ହସ୍ତଶିଳ୍ପ ବିକାଶ କାର୍ଯ୍ୟକ୍ରମ" : language === "hi" ? "राष्ट्रीय हस्तशिल्प विकास कार्यक्रम" : "National Handicraft Development Programme",
      description: language === "or" ? "ପ୍ରଦର୍ଶନୀ, ବଜାର ପ୍ରବେଶ ଏବଂ ସ୍ୱାସ୍ଥ୍ୟ ବୀମା ପାଇଁ ସରକାରୀ ସହାୟତା।" : language === "hi" ? "प्रदर्शनियों, बाजार पहुंच और स्वास्थ्य बीमा के लिए सरकारी समर्थन।" : "Government support for exhibitions, market access and health insurance.",
      amount: "Health Cover",
      incomeLimit: 500000,
      icon: <CheckCircle2 className="text-blue-500" size={24} />
    },
    {
      id: 3,
      name: language === "or" ? "ଆମ୍ବେଦକର ହସ୍ତଶିଳ୍ପ ବିକାଶ ଯୋଜନା" : language === "hi" ? "अम्बेडकर हस्तशिल्प विकास योजना" : "Ambedkar Hastshilp Vikas Yojana",
      description: language === "or" ? "ଏସସି/ଏସଟି ଏବଂ ମହିଳା କାରିଗରମାନଙ୍କ ପାଇଁ ବୈଷୟିକ ଏବଂ ଆର୍ଥିକ ସହାୟତା।" : language === "hi" ? "विशेष रूप से एससी/एसटी और महिला कारीगरों के लिए तकनीकी और वित्तीय सहायता।" : "Technical and financial assistance specifically for SC/ST and women artisans.",
      amount: "₹25,000 Grant",
      incomeLimit: 150000,
      icon: <FileText className="text-purple-500" size={24} />
    }
  ];

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;

  const income = profile?.annualIncome || 0;
  const eligibleSchemes = allSchemes.filter(s => income <= s.incomeLimit);

  const startAutoApply = (scheme: any) => {
    setSimulatingScheme(scheme);
    setSimStep(0);
    
    // Simulate API calls through DigiLocker / UIDAI
    setTimeout(() => setSimStep(1), 1500); // Gathering Aadhaar
    setTimeout(() => setSimStep(2), 3500); // Checking Bank Linkage
    setTimeout(() => {
      if (!profile?.aadhaarLast4) {
         setSimStep(3); // Prompt for missing credentials
      } else {
         setSimStep(4); // Success
         setNewlyApplied(prev => [...prev, scheme.id]);
      }
    }, 5500);
  };

  const getSchemeStatus = (schemeName: string, schemeId: number) => {
    if (newlyApplied.includes(schemeId)) {
      return { status: 'PENDING_APPROVAL', notes: 'Application submitted via DigiLocker API.' };
    }
    const app = applications.find(a => a.schemeName === schemeName || (schemeName.includes('Handicraft') && a.schemeName.includes('Handicraft')));
    if (app) return { status: app.status, notes: app.notes };
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-16">
      <header className="px-4 sm:px-8 py-4 bg-white border-b border-gray-200 sticky top-0 z-40 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/artisan/dashboard" className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
            <ArrowLeft size={20} className="text-gray-600" />
          </Link>
          <h1 className="text-xl font-bold text-gray-900">{language === "or" ? "ସରକାରୀ ଯୋଜନା" : language === "hi" ? "सरकारी योजनाएँ" : "Government Schemes"}</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 sm:p-8 space-y-8 mt-4">
        <div className="bg-[#E6F4EA] border border-green-200 rounded-2xl p-6">
          <h2 className="text-green-800 font-bold text-lg mb-2">Automated Scheme Enrollment</h2>
          <p className="text-green-700 text-sm leading-relaxed">
            Based on your declared income of ₹{income}, you are eligible for <strong>{eligibleSchemes.length} schemes</strong>. Our AI can automatically pull your UIDAI (Aadhaar) and banking credentials via DigiLocker and submit the applications for you.
          </p>
        </div>

        <div className="space-y-4">
          {allSchemes.map(scheme => {
            const statusData = getSchemeStatus(scheme.name, scheme.id);
            return (
              <div key={scheme.id} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex flex-col sm:flex-row gap-4 sm:items-start justify-between">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center shrink-0 border border-gray-100">
                      {scheme.icon}
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900 text-lg mb-1">{scheme.name}</h4>
                      <p className="text-sm text-gray-500 mb-3 max-w-lg">{scheme.description}</p>
                      <div className="inline-flex bg-green-50 text-green-700 px-3 py-1 rounded-full text-xs font-bold border border-green-100 mb-2">
                        Benefit: {scheme.amount}
                      </div>
                      {statusData && (
                        <div className="bg-gray-50 border border-gray-100 p-3 rounded-lg text-sm text-gray-600">
                          <span className="font-bold text-gray-900">Agent Update:</span> {statusData.notes}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-2 mt-4 sm:mt-0 sm:min-w-[160px]">
                    {statusData ? (
                      <div className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 border ${
                        statusData.status === 'DISBURSED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        statusData.status === 'APPROVED' ? 'bg-green-50 text-green-700 border-green-200' :
                        'bg-orange-50 text-orange-700 border-orange-200'
                      }`}>
                        {statusData.status === 'DISBURSED' ? <Award size={16}/> : 
                         statusData.status === 'APPROVED' ? <CheckCircle2 size={16}/> : 
                         <Clock size={16} />}
                        {statusData.status.replace('_', ' ')}
                      </div>
                    ) : (
                      <>
                        <button onClick={() => startAutoApply(scheme)} className="bg-[#0F2D20] hover:bg-[#1A4731] text-white w-full py-3 rounded-xl font-bold shadow-sm transition-colors text-sm flex items-center justify-center gap-2">
                          <ShieldCheck size={16} /> Auto-Apply via AI
                        </button>
                        <button className="bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 w-full py-2 rounded-xl font-bold shadow-sm transition-colors text-sm">
                          Apply Manually
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Auto Apply Simulation Modal */}
      {simulatingScheme && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl p-6 relative">
            <button onClick={() => setSimulatingScheme(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
            <h3 className="text-xl font-bold text-gray-900 mb-6">AI Auto-Enrollment</h3>
            
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${simStep >= 1 ? 'border-green-500 bg-green-50 text-green-600' : 'border-gray-200 text-gray-300'}`}>
                  {simStep >= 1 ? <CheckCircle2 size={16} /> : 1}
                </div>
                <div className="flex-1">
                  <p className={`font-bold ${simStep >= 1 ? 'text-gray-900' : 'text-gray-400'}`}>Verifying Aadhaar Identity</p>
                  {simStep === 0 && <p className="text-xs text-gray-400 animate-pulse">Connecting to UIDAI / DigiLocker...</p>}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${simStep >= 2 ? 'border-green-500 bg-green-50 text-green-600' : 'border-gray-200 text-gray-300'}`}>
                  {simStep >= 2 ? <CheckCircle2 size={16} /> : 2}
                </div>
                <div className="flex-1">
                  <p className={`font-bold ${simStep >= 2 ? 'text-gray-900' : 'text-gray-400'}`}>Validating Direct Benefit Transfer (DBT)</p>
                  {simStep === 1 && <p className="text-xs text-gray-400 animate-pulse">Checking NPCI bank linkage...</p>}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${simStep >= 4 ? 'border-green-500 bg-green-50 text-green-600' : simStep === 3 ? 'border-red-500 bg-red-50 text-red-600' : 'border-gray-200 text-gray-300'}`}>
                  {simStep >= 4 ? <CheckCircle2 size={16} /> : simStep === 3 ? <X size={16} /> : 3}
                </div>
                <div className="flex-1">
                  <p className={`font-bold ${simStep >= 4 ? 'text-gray-900' : simStep === 3 ? 'text-red-600' : 'text-gray-400'}`}>Compiling Credentials</p>
                  {simStep === 2 && <p className="text-xs text-gray-400 animate-pulse">Drafting application payload...</p>}
                </div>
              </div>
            </div>

            {simStep === 3 && (
              <div className="mt-6 bg-red-50 border border-red-100 p-4 rounded-xl text-sm">
                <p className="font-bold text-red-800 mb-1">Missing Information</p>
                <p className="text-red-700 mb-3">Your profile is missing a linked Aadhaar number. We need this credential to automatically apply for the scheme.</p>
                <Link href="/artisan/dashboard" className="block text-center w-full bg-red-600 text-white font-bold py-2 rounded-lg hover:bg-red-700">
                  Go to Profile Editor
                </Link>
              </div>
            )}

            {simStep === 4 && (
              <div className="mt-6 bg-green-50 border border-green-100 p-4 rounded-xl text-sm text-center">
                <CheckCircle2 size={32} className="mx-auto text-green-600 mb-2" />
                <p className="font-bold text-green-800 text-lg">Application Submitted!</p>
                <p className="text-green-700 mb-4 mt-1">Your AI Agent successfully invoked the government APIs to enroll you in {simulatingScheme.name}.</p>
                <button onClick={() => setSimulatingScheme(null)} className="w-full bg-green-700 text-white font-bold py-2 rounded-lg hover:bg-green-800">
                  Close
                </button>
              </div>
            )}
            
            <div className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-400 text-center italic">
              *For SIH Demo: Simulates API integration with DigiLocker. In production, this requires explicit user consent and MoSJE legal authorization.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
