"use client";

import { useEffect, useRef } from "react";
import { useLanguage } from "@/lib/translations";

const digitMaps: Record<string, string[]> = {
  hi: ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"],
  or: ["୦", "୧", "୨", "୩", "୪", "୫", "୬", "୭", "୮", "୯"],
  te: ["౦", "౧", "౨", "౩", "౪", "౫", "౬", "౭", "౮", "౯"],
  en: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
};

const reverseMaps: Record<string, Record<string, string>> = {};
for (const [lang, map] of Object.entries(digitMaps)) {
  if (lang === 'en') continue;
  reverseMaps[lang] = {};
  map.forEach((digit, index) => {
    reverseMaps[lang][digit] = index.toString();
  });
}

// Persistent cache to avoid re-translating same strings across navigations and reloads
const getCache = (lang: string) => {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(`translation_cache_${lang}`) || "{}");
  } catch { return {}; }
};

const setCache = (lang: string, cache: Record<string, string>) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`translation_cache_${lang}`, JSON.stringify(cache));
};

export function AutoTranslator() {
  const { language } = useLanguage();
  const queueRef = useRef<Set<Node>>(new Set());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    if (language === 'en') {
      // Revert logic...
      const unlocalizeNode = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
          let original = (node as any).__originalText || node.nodeValue;
          let changed = false;
          
          for (const lang of Object.keys(reverseMaps)) {
            for (const [regional, ascii] of Object.entries(reverseMaps[lang])) {
              if (original.includes(regional)) {
                original = original.replaceAll(regional, ascii);
                changed = true;
              }
            }
          }
          
          if ((node as any).__originalText && (node as any).__originalText !== node.nodeValue) {
             changed = true;
          }

          if (changed && node.nodeValue !== original) {
            node.nodeValue = original;
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          node.childNodes.forEach(unlocalizeNode);
        }
      };
      
      unlocalizeNode(document.body);
      
      const observer = new MutationObserver((mutations) => {
        mutations.forEach(m => {
          if (m.type === 'childList') m.addedNodes.forEach(unlocalizeNode);
          else if (m.type === 'characterData') unlocalizeNode(m.target);
        });
      });
      observer.observe(document.body, { childList: true, characterData: true, subtree: true });
      return () => observer.disconnect();
    }

    const map = digitMaps[language];
    const currentCache = getCache(language);
    
    const processQueue = async () => {
      if (queueRef.current.size === 0 || isProcessingRef.current) return;
      isProcessingRef.current = true;

      const allNodes = Array.from(queueRef.current);
      queueRef.current.clear();
      
      const BATCH_SIZE = 40;
      for (let j = 0; j < allNodes.length; j += BATCH_SIZE) {
        const nodesToTranslate = allNodes.slice(j, j + BATCH_SIZE);
        // De-duplicate strings to reduce payload
        const stringsToTranslate = nodesToTranslate.map(node => ((node as any).__originalText || node.nodeValue || "").trim());
        
        try {
          const res = await fetch('/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ strings: stringsToTranslate, targetLanguage: language })
          });
          
          if (!res.ok) {
             // Rate limited or error, wait a bit before continuing
             await new Promise(r => setTimeout(r, 2000));
             continue;
          }
          
          const data = await res.json();
          
          if (data.translated && Array.isArray(data.translated)) {
            let cacheUpdated = false;
            data.translated.forEach((translatedStr: string, i: number) => {
              if (!translatedStr) return;
              const node = nodesToTranslate[i];
              const originalStr = stringsToTranslate[i];
              
              if (currentCache[originalStr] !== translatedStr) {
                 currentCache[originalStr] = translatedStr;
                 cacheUpdated = true;
              }
              
              const sourceText = ((node as any).__originalText || node.nodeValue || "");
              let targetText = sourceText.replace(originalStr, translatedStr);
              
              if (map) {
                 targetText = targetText.replace(/[0-9]/g, (digit: string) => map[parseInt(digit, 10)]);
              }
              
              if (node.nodeValue !== targetText) {
                node.nodeValue = targetText;
              }
            });
            if (cacheUpdated) setCache(language, currentCache);
          }
        } catch (err) {
          console.error('Auto translation failed', err);
        }
      }
      
      isProcessingRef.current = false;
      // If new nodes were added while processing, trigger again
      if (queueRef.current.size > 0) {
         timerRef.current = setTimeout(processQueue, 1000);
      }
    };

    const localizeNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
        if (node.parentElement && ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.parentElement.tagName)) return;
        
        const original = node.nodeValue;
        if (!original.trim()) return;

        if (!(node as any).__originalText) {
           (node as any).__originalText = original;
        }

        const sourceText = (node as any).__originalText;
        const trimmedSource = sourceText.trim();
        let isTranslated = false;
        let targetText = sourceText;

        if (/[A-Za-z]/.test(trimmedSource)) {
           const cached = currentCache[trimmedSource];
           if (cached) {
              targetText = sourceText.replace(trimmedSource, cached);
              isTranslated = true;
           } else {
              queueRef.current.add(node);
              if (timerRef.current) clearTimeout(timerRef.current);
              timerRef.current = setTimeout(processQueue, 1500);
           }
        } else {
           isTranslated = true;
        }

        if (isTranslated && map) {
           const localized = targetText.replace(/[0-9]/g, (digit: string) => map[parseInt(digit, 10)]);
           if (node.nodeValue !== localized) {
              node.nodeValue = localized;
           }
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        node.childNodes.forEach(localizeNode);
      }
    };

    localizeNode(document.body);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(localizeNode);
        } else if (mutation.type === 'characterData') {
          localizeNode(mutation.target);
        }
      });
    });

    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timerRef.current) clearTimeout(timerRef.current);
      queueRef.current.clear();
    };
  }, [language]);

  return null;
}
