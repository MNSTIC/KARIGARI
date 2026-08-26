"use client";

import { useState, useEffect } from "react";
import { X, Save, Upload, User, Mic, MapPin, Info } from "lucide-react";
import { CITY_OPTIONS, locateCity } from "@/lib/indiaGeo";
import { useLanguage, Language } from "@/lib/translations";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface ProfileEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  artisanData: any;
  onSaved: () => void;
}

export function ProfileEditorModal({ isOpen, onClose, artisanData, onSaved }: ProfileEditorModalProps) {
  const { language } = useLanguage();
  const [photoUrl, setPhotoUrl] = useState(artisanData?.photoUrl || "/female_artisan.jpg");
  const [name, setName] = useState(artisanData?.name || "");
  const [mobileNumber, setMobileNumber] = useState(artisanData?.mobileNumber || "");
  const [aadhaarLast4, setAadhaarLast4] = useState(artisanData?.aadhaarLast4 || "");
  const [socialCategory, setSocialCategory] = useState(artisanData?.socialCategory || "");
  const [annualIncome, setAnnualIncome] = useState(
    artisanData?.annualIncome === null || artisanData?.annualIncome === undefined ? "" : String(artisanData.annualIncome)
  );
  const [location, setLocation] = useState(artisanData?.location || "");
  const [upiId, setUpiId] = useState(artisanData?.upiId || "");
  const [description, setDescription] = useState(artisanData?.description || "");
  const [isSaving, setIsSaving] = useState(false);

  const [listeningField, setListeningField] = useState<'name' | 'desc' | null>(null);
  const [recognitionInstance, setRecognitionInstance] = useState<any>(null);

  // Re-hydrate on every OPEN, not just when the object identity changes —
  // otherwise edits abandoned with Cancel survive and get written on the next save.
  useEffect(() => {
    if (isOpen && artisanData) {
      setPhotoUrl(artisanData.photoUrl || "/female_artisan.jpg");
      setName(artisanData.name || "");
      setMobileNumber(artisanData.mobileNumber || "");
      setAadhaarLast4(artisanData.aadhaarLast4 || "");
      setSocialCategory(artisanData.socialCategory || "");
      setAnnualIncome(
        artisanData.annualIncome === null || artisanData.annualIncome === undefined ? "" : String(artisanData.annualIncome)
      );
      setLocation(artisanData.location || "");
      setUpiId(artisanData.upiId || "");
      setDescription(artisanData.description || "");
    }
  }, [artisanData, isOpen]);

  const toggleListening = (field: 'name' | 'desc') => {
    if (listeningField === field && recognitionInstance) {
      recognitionInstance.stop();
      setListeningField(null);
      return;
    }

    if (recognitionInstance) {
      recognitionInstance.stop();
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in your browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    const langMap: Record<Language, string> = {
      en: 'en-US',
      hi: 'hi-IN',
      or: 'or-IN',
      te: 'te-IN'
    };
    recognition.lang = langMap[language] || 'hi-IN';
    recognition.interimResults = true;
    recognition.continuous = true;

    let baseText = field === 'name' ? name : description;
    if (baseText && !baseText.endsWith(" ")) {
      baseText += " ";
    }

    recognition.onstart = () => setListeningField(field);
    
    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      
      if (final) baseText += final;
      
      if (field === 'name') {
        setName(baseText + interim);
      } else {
        setDescription(baseText + interim);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech error:", event.error);
      if (event.error === 'network') {
        alert("Network error: Speech recognition failed to connect. Please check your internet connection.");
      } else if (event.error !== 'no-speech') {
        alert(`Speech recognition error: ${event.error}`);
      }
      setListeningField(null);
    };

    recognition.onend = () => {
      setListeningField(null);
    };

    setRecognitionInstance(recognition);
    recognition.start();
  };

  if (!isOpen) return null;

  // Opened before the profile finished loading. Rendering the form here would let
  // Save write blanks over exactly the columns the eligibility engine reads
  // (aadhaarLast4, upiId, socialCategory, annualIncome), so refuse instead.
  if (!artisanData) {
    return (
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
            <h2 className="font-serif font-bold text-lg text-primary">Edit Profile</h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500" aria-label="Close">
              <X size={20} />
            </button>
          </div>
          <div className="p-6">
            <p className="text-sm text-gray-600">
              Your profile could not be loaded, so it cannot be edited right now. Close this
              and refresh the page.
            </p>
          </div>
          <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
            <button onClick={onClose} className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-xl transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const locationResolves = Boolean(locateCity(location));

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Blank means "not recorded" — send null so the server clears the field
      // instead of storing an empty string the eligibility engine can't read.
      const parsedIncome = annualIncome.trim() === "" ? null : Number(annualIncome);

      const res = await fetch("/api/artisan/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          photoUrl,
          location,
          upiId,
          description,
          mobileNumber,
          aadhaarLast4,
          socialCategory: socialCategory === "" ? null : socialCategory,
          annualIncome: parsedIncome !== null && Number.isFinite(parsedIncome) ? parsedIncome : null
        })
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        const err = await res.json();
        alert("Failed to save profile: " + (err.error || "Unknown error"));
      }
    } catch (e: any) {
      console.error(e);
      alert("Network error: " + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setPhotoUrl(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in-up">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
          <h2 className="font-serif font-bold text-lg text-primary">Edit Profile</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 space-y-6 overflow-y-auto">
          <div className="flex flex-col items-center gap-4">
            <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-primary/20 relative group">
              <Image src={photoUrl} alt="Profile" fill className="object-cover" />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Upload size={24} className="text-white" />
              </div>
              <input type="file" accept="image/*" onChange={handlePhotoUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
            </div>
            <p className="text-xs text-gray-500 font-bold uppercase">Tap to change photo</p>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1 flex justify-between items-center">
              Full Name
              <button onClick={() => toggleListening('name')} className={cn("p-1 rounded-full", listeningField === 'name' ? "bg-red-50 text-red-500 animate-pulse" : "text-gray-400 hover:text-primary")}>
                <Mic size={16} />
              </button>
            </label>
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your Name"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Mobile Number (SMS/WhatsApp Alerts)</label>
            <input 
              type="tel" 
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value)}
              placeholder="+91 9876543210"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Aadhaar Last 4 Digits (For Verification)</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                maxLength={4}
                value={aadhaarLast4}
                onChange={(e) => setAadhaarLast4(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 1234"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
              />
              <button 
                className="shrink-0 bg-blue-50 text-blue-700 px-4 rounded-xl font-bold border border-blue-200 hover:bg-blue-100 transition-colors"
                onClick={() => alert("In a production environment, this would securely verify against UIDAI.")}
              >
                Verify
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Social Category</label>
            <select
              value={socialCategory}
              onChange={(e) => setSocialCategory(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
            >
              <option value="">Select category</option>
              <option value="SC">SC — Scheduled Caste</option>
              <option value="ST">ST — Scheduled Tribe</option>
              <option value="OBC">OBC — Other Backward Classes</option>
              <option value="EWS">EWS — Economically Weaker Section</option>
              <option value="GENERAL">General</option>
            </select>
            <p className="text-xs text-gray-500 mt-1.5">
              Used to check NSFDC / NBCFDC eligibility. Never shared with buyers.
            </p>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Annual Household Income (₹)</label>
            <input
              type="number"
              min={0}
              step={1000}
              value={annualIncome}
              onChange={(e) => setAnnualIncome(e.target.value)}
              placeholder="e.g. 120000"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1 flex items-center gap-1">
              <MapPin size={14} /> Town or City
            </label>
            <input
              type="text"
              list="karigari-profile-cities"
              autoComplete="off"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Start typing, e.g. Pochampally"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
            />
            <datalist id="karigari-profile-cities">
              {CITY_OPTIONS.map((city) => (
                <option key={city} value={city} />
              ))}
            </datalist>
            {location.trim() !== "" && !locationResolves ? (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                <Info size={13} className="shrink-0 mt-0.5" />
                <span>
                  We cannot place this on the demand map. Pick the nearest town from the list —
                  a state name on its own will not place a pin.
                </span>
              </p>
            ) : (
              <p className="text-xs text-gray-500 mt-1.5">
                This is where your pin sits on the demand map, and how buyers near you are ranked.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">UPI ID for Payments</label>
            <input 
              type="text" 
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="e.g. 9876543210@ybl"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1 flex justify-between items-center">
              About Me (Bio)
              <button onClick={() => toggleListening('desc')} className={cn("p-1 rounded-full", listeningField === 'desc' ? "bg-red-50 text-red-500 animate-pulse" : "text-gray-400 hover:text-primary")}>
                <Mic size={16} />
              </button>
            </label>
            <textarea 
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell your story to the buyers..."
              rows={4}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all resize-none"
            />
          </div>
          
          <div className="bg-blue-50 text-blue-800 text-xs p-3 rounded-xl flex items-start gap-2">
            <User className="shrink-0 mt-0.5" size={14} />
            <p>Your Tags: <strong>{artisanData?.tags?.join(", ") || "None"}</strong>. Tags are added automatically when you capture new craft types.</p>
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-xl transition-colors">
            Cancel
          </button>
          <button
              onClick={handleSave}
              disabled={isSaving || !location.trim() || !locationResolves}
            className="px-6 py-2.5 bg-primary hover:bg-primary-dark text-white font-bold rounded-xl transition-colors flex items-center gap-2"
          >
            {isSaving ? "Saving..." : <><Save size={18} /> Save Profile</>}
          </button>
        </div>
      </div>
    </div>
  );
}
