const fs = require('fs');
let content = fs.readFileSync('src/app/api/transcribe/route.ts', 'utf8');

content = content.replace(
  `} else if (currentRoute?.includes("schemes")) {\n      response = "I will help you apply for this scheme using your verified Aadhaar profile.";`,
  `} else if (currentRoute?.includes("schemes")) {
      if (transcriptText.toLowerCase().includes('vishwakarma') || transcriptText.toLowerCase().includes('benefit') || transcriptText.toLowerCase().includes('what') || transcriptText.toLowerCase().includes('scheme')) {
         if (language === 'hi') {
            response = 'पीएम विश्वकर्मा योजना के तहत आपको ₹15,000 का टूलकिट, 5% ब्याज पर ऋण और कौशल प्रशिक्षण मिलता है। क्या मैं आपके लिए ऑटो-अप्लाई कर दूँ?';
         } else if (language === 'or') {
            response = 'ପିଏମ୍ ବିଶ୍ୱକର୍ମା ଯୋଜନାରେ ଆପଣଙ୍କୁ ₹୧୫,୦୦୦ ର ଟୁଲକିଟ୍, ୫% ସୁଧରେ ଋଣ ଏବଂ ଦକ୍ଷତା ତାଲିମ ମିଳିବ। ମୁଁ ଆପଣଙ୍କ ପାଇଁ ଅଟୋ-ଅପ୍ଲାଏ କରିଦେବି କି?';
         } else {
            response = 'Under the PM Vishwakarma Yojana, you get a ₹15,000 toolkit incentive, collateral-free credit at 5% interest, and skill training. Shall I auto-apply for you?';
         }
      } else {
         response = 'I will help you apply for this scheme using your verified Aadhaar profile. Just click the Auto-Apply button.';
      }
`
);

fs.writeFileSync('src/app/api/transcribe/route.ts', content);
