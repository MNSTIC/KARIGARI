const fs = require('fs');

const updateDict = (file, newEntries, replacements) => {
  let content = fs.readFileSync(file, 'utf8');
  
  if (replacements) {
    for (const [search, replace] of Object.entries(replacements)) {
      content = content.replace(search, replace);
    }
  }

  // Remove the last '};'
  const lastBraceIndex = content.lastIndexOf('};');
  if (lastBraceIndex === -1) return;
  
  let newContent = content.substring(0, lastBraceIndex);
  
  // Add new entries
  if (newEntries) {
    for (const [k, v] of Object.entries(newEntries)) {
      newContent += `\n  ${k}: "${v}",`;
    }
  }
  
  newContent += '\n};\n';
  fs.writeFileSync(file, newContent);
};

// EN
updateDict('src/lib/i18n/en.ts', {
  edit_listing_text: 'Edit listing',
  asking_price_label: 'Asking Price (₹)',
  add_more_images: 'Add More Images',
  delete_listing: 'Delete Listing'
}, {
  'trust_and_reports: "Trust & Reports",': 'trust_and_reports: "Health Score",',
  'edit_listing_text: "Edit listing text",': ''
});

// HI
updateDict('src/lib/i18n/hi.ts', {
  edit_listing_text: 'लिस्टिंग संपादित करें',
  asking_price_label: 'पूछी गई कीमत (₹)',
  add_more_images: 'और चित्र जोड़ें',
  delete_listing: 'लिस्टिंग हटाएं'
}, {
  'trust_and_reports: "ट्रस्ट और रिपोर्ट",': 'trust_and_reports: "स्वास्थ्य स्कोर",',
  'edit_listing_text: "लिस्टिंग पाठ संपादित करें",': ''
});

// OR
updateDict('src/lib/i18n/or.ts', {
  edit_listing_text: 'ତାଲିକା ସମ୍ପାଦନ କରନ୍ତୁ',
  asking_price_label: 'ମାଗିଥିବା ମୂଲ୍ୟ (₹)',
  add_more_images: 'ଅଧିକ ଚିତ୍ର ଯୋଡନ୍ତୁ',
  delete_listing: 'ତାଲିକା ବିଲୋପ କରନ୍ତୁ'
}, {
  'trust_and_reports: "ବିଶ୍ୱାସ ଏବଂ ରିପୋର୍ଟଗୁଡିକ",': 'trust_and_reports: "ସ୍ୱାସ୍ଥ୍ୟ ସ୍କୋର",',
  'edit_listing_text: "ତାଲିକା ପାଠ୍ୟ ସମ୍ପାଦନ କରନ୍ତୁ",': ''
});

// TE
updateDict('src/lib/i18n/te.ts', {
  edit_listing_text: 'జాబితాను సవరించండి',
  asking_price_label: 'అడిగే ధర (₹)',
  add_more_images: 'మరిన్ని చిత్రాలను జోడించండి',
  delete_listing: 'జాబితాను తొలగించండి'
}, {
  'trust_and_reports: "ట్రస్ట్ & నివేదికలు",': 'trust_and_reports: "ఆరోగ్య స్కోర్",',
  'edit_listing_text: "జాబితా వచనాన్ని సవరించండి",': ''
});
