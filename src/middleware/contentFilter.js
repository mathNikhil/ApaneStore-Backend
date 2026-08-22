const BLOCKLIST = {
  weapons: [
    'gun','guns','pistol','pistols','rifle','rifles','shotgun','shotguns','revolver','revolvers',
    'firearm','firearms','ak47','ak-47','m16','ar15','ar-16','machine gun','sniper','carbine',
    'ammunition','ammo','bullet','bullets','cartridge','magazine clip','silencer','suppressor',
    'explosive','explosives','grenade','grenades','bomb','bombs','landmine','landmines','rpg',
    'dynamite','tnt','c4','detonator','bayonet','taser','stun gun','stun baton',
    'pepper spray','mace spray','knuckle duster','brass knuckle','switchblade',
    'flick knife','gravity knife','butterfly knife','combat knife','throwing star','shuriken',
    'crossbow','slingshot weapon','air gun','bb gun','pellet gun'
  ],
  drugs: [
    'cocaine','heroin','marijuana','cannabis','weed','mdma','ecstasy','meth','methamphetamine',
    'opium','narcotic','narcotics','hashish','hash','lsd','acid tabs','crack','crack cocaine',
    'ganja','charas','smack','brown sugar','ketamine','morphine','fentanyl','oxycodone',
    'tramadol abuse','codeine abuse','afim','bhang abuse','doda','poppy husk',
    'psychedelic','psilocybin','magic mushroom','dmt','pcp','angel dust','ghb','rohypnol',
    'date rape drug','crystal meth','ice drug','speed drug','krokodil','spice drug',
    'synthetic cannabis','bath salts drug','designer drug','nps drug'
  ],
  prescription_medicines: [
    'schedule h','schedule x','prescription only','rx only',
    'alprazolam','diazepam','clonazepam','lorazepam','zolpidem',
    'oxycontin','percocet','vicodin','hydrocodone','buprenorphine',
    'steroids injection','anabolic steroid','testosterone injection',
    'sleeping pills sell','sedative sell','benzodiazepine sell'
  ],
  counterfeit: [
    'fake','replica','duplicate','first copy','1st copy','a grade copy','aaa grade',
    'master copy','super copy','high copy','mirror copy','copy of branded',
    'inspired by branded','b grade copy','superfake','dupe of branded',
    'fake currency','counterfeit money','fake note','fake rupee','fake dollar',
    'forged document','fake passport','fake id card','fake driving licence',
    'fake aadhar','fake pan card','fake degree certificate','fake marksheet'
  ],
  adult: [
    'pornography','porn','xxx','explicit content','escort service','prostitution',
    'call girl service','massage with happy ending','adult film','sex film',
    'nude photo','explicit photo','onlyfans content','adult only content',
    'sex toy','dildo','vibrator','fleshlight','bdsm equipment',
    'adult subscription','explicit subscription'
  ],
  wildlife: [
    'ivory','elephant tusk','tiger skin','leopard skin','leopard fur','cheetah skin',
    'lion skin','bear skin','wolf skin','pangolin','pangolin scale','rhino horn',
    'shahtoosh','tortoise shell','turtle shell','snake skin illegal','crocodile skin illegal',
    'bear bile','musk deer pod','red sanders illegal','sandalwood illegal',
    'exotic animal','live endangered animal','protected bird','eagle feather illegal',
    'coral illegal','sea cucumber illegal','sea horse illegal','dried seahorse'
  ],
  tobacco_alcohol: [
    'cigarette','cigarettes','bidi','bidis','hookah','hookah tobacco','shisha tobacco',
    'chewing tobacco','gutka','pan masala tobacco','khaini','zarda','tobacco pouch',
    'nicotine pouch sell','vape juice','e-cigarette','vaping device sell',
    'tobacco product','smoking product',
    'whiskey sell','vodka sell','rum sell','beer sell','wine sell','alcohol sell',
    'liquor sell','spirits sell','brandy sell','gin sell','tequila sell',
    'country liquor','desi daru','sharab','alcohol delivery'
  ],
  gambling: [
    'lottery ticket','betting slip','casino chip','gambling token','sports bet',
    'illegal lottery','satta','matka','cricket betting','ipl betting',
    'horse race bet','online casino','poker chip illegal','slot machine illegal'
  ],
  piracy_hacking: [
    'cracked software','pirated movie','pirated film','nulled theme','nulled plugin',
    'pirated ebook','pirated course','hacked account','cracked account',
    'malware','keylogger','rat tool','remote access trojan','skimmer','phishing kit',
    'spyware','ransomware','ddos tool','hacking tool','exploit kit',
    'stolen data','leaked database','hacked database','cvv dump','credit card dump',
    'carding tool','account cracker','password cracker'
  ],
  human_trafficking: [
    'human trafficking','child labour','escort agency','sex tourism',
    'organ sell','kidney sell','blood sell illegal','human organ',
    'child exploitation','minor exploitation','trafficking service',
    'smuggling service','illegal immigration service','fake visa service'
  ],
  wmd: [
    'chemical weapon','biological weapon','nuclear material','radioactive material',
    'sarin gas','nerve agent','mustard gas','anthrax','ricin','polonium',
    'dirty bomb','uranium sell','plutonium sell','toxic chemical weapon'
  ],
  surveillance: [
    'hidden camera spy','spy camera','imsi catcher','stingray device',
    'stalkerware','spyware app','phone tracker hidden','keylogger hidden',
    'gps tracker hidden illegal','eavesdropping device','wire tap device',
    'voice recorder hidden illegal'
  ],
};

const CATEGORY_LABELS = {
  weapons:               'Weapons & Firearms',
  drugs:                 'Drugs & Narcotics',
  prescription_medicines:'Prescription Medicines',
  counterfeit:           'Counterfeit & Fake Products',
  adult:                 'Adult & Explicit Content',
  wildlife:              'Protected Wildlife Products',
  tobacco_alcohol:       'Tobacco & Alcohol',
  gambling:              'Gambling Products',
  piracy_hacking:        'Piracy & Hacking Tools',
  human_trafficking:     'Human Trafficking & Exploitation',
  wmd:                   'Weapons of Mass Destruction',
  surveillance:          'Illegal Surveillance Equipment',
};

const ALL_KEYWORDS = [];
Object.entries(BLOCKLIST).forEach(([category, keywords]) => {
  keywords.forEach(keyword => {
    ALL_KEYWORDS.push({ keyword: keyword.toLowerCase(), category });
  });
});

const scanText = (text) => {
  if (!text) return { flagged: false };
  const lower = text.toLowerCase();
  for (const { keyword, category } of ALL_KEYWORDS) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(lower)) {
      return { flagged: true, keyword, category };
    }
  }
  return { flagged: false };
};

const extractTextFields = (body) => {
  const fields = [];
  if (body.name)        fields.push({ field: 'Product Name', text: body.name });
  if (body.description) fields.push({ field: 'Description',  text: body.description });
  if (body.category)    fields.push({ field: 'Category',     text: body.category });
  if (body.sku)         fields.push({ field: 'SKU',          text: body.sku });

  if (body.categories && Array.isArray(body.categories)) {
    body.categories.forEach(cat => {
      if (cat.name) fields.push({ field: `Category "${cat.name}"`, text: cat.name });
      if (cat.products && Array.isArray(cat.products)) {
        cat.products.forEach(prod => {
          if (prod.name)        fields.push({ field: `Product "${prod.name}"`,             text: prod.name });
          if (prod.description) fields.push({ field: `Product "${prod.name}" description`, text: prod.description });
          if (prod.variations && Array.isArray(prod.variations)) {
            prod.variations.forEach(v => {
              if (v.name) fields.push({ field: `Variant "${v.name}"`, text: v.name });
              if (v.sizes && Array.isArray(v.sizes)) {
                v.sizes.forEach(s => {
                  if (s.name) fields.push({ field: `Size/Color "${s.name}"`, text: s.name });
                });
              }
            });
          }
        });
      }
    });
  }

  if (body.variations && Array.isArray(body.variations)) {
    body.variations.forEach(v => {
      if (v.name) fields.push({ field: `Variant "${v.name}"`, text: v.name });
      if (v.sizes && Array.isArray(v.sizes)) {
        v.sizes.forEach(s => {
          if (s.name) fields.push({ field: `Size/Color "${s.name}"`, text: s.name });
        });
      }
    });
  }

  return fields;
};

const contentFilter = (req, res, next) => {
  const fields = extractTextFields(req.body);
  for (const { field, text } of fields) {
    const result = scanText(text);
    if (result.flagged) {
      return res.status(400).json({
        success: false,
        error: `The term "${result.keyword}" is not permitted in ${field}. Category: ${CATEGORY_LABELS[result.category]}. This product cannot be listed on AapnaEstore. Please review our Platform Policy.`,
        flagged: true,
        keyword: result.keyword,
        category: result.category,
        field: field,
      });
    }
  }
  next();
};

module.exports = contentFilter;
