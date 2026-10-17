/* Quantest fact bank.
   a   = the number that settles the market
   tol = "exact" (a count or definition) or "approx" (best public estimate; note says which)
   cat = which unit on the path it belongs to
   Keep every answer sourced in `note` so the reveal screen can show it. */

window.QUANTEST_FACTS = [
  // ---- warmup: numbers most people half-know ----
  { id: "piano", q: "How many keys are on a standard piano?", a: 88, unit: "keys", cat: "warmup", tol: "exact", note: "52 white and 36 black." },
  { id: "chess-squares", q: "How many squares are on a chessboard?", a: 64, unit: "squares", cat: "warmup", tol: "exact", note: "8 by 8." },
  { id: "deck", q: "How many cards are in a standard deck (no jokers)?", a: 52, unit: "cards", cat: "warmup", tol: "exact", note: "4 suits of 13." },
  { id: "dice-dots", q: "How many dots are on a pair of dice in total?", a: 42, unit: "dots", cat: "warmup", tol: "exact", note: "21 per die." },
  { id: "teeth", q: "How many teeth does an adult human normally have?", a: 32, unit: "teeth", cat: "warmup", tol: "exact", note: "Including four wisdom teeth." },
  { id: "us-states", q: "How many states are in the USA?", a: 50, unit: "states", cat: "warmup", tol: "exact", note: "Since Hawaii joined in 1959." },
  { id: "planets", q: "How many planets are in the Solar System?", a: 8, unit: "planets", cat: "warmup", tol: "exact", note: "Pluto was reclassified in 2006." },
  { id: "seconds-day", q: "How many seconds are in a day?", a: 86400, unit: "seconds", cat: "warmup", tol: "exact", note: "24 × 60 × 60." },
  { id: "marathon", q: "How long is a marathon in metres?", a: 42195, unit: "m", cat: "warmup", tol: "exact", note: "Standardised in 1921." },
  { id: "football-pent", q: "How many pentagons are on a classic 32-panel football?", a: 12, unit: "pentagons", cat: "warmup", tol: "exact", note: "12 pentagons and 20 hexagons (a truncated icosahedron)." },
  { id: "golf", q: "How many holes are on a full golf course?", a: 18, unit: "holes", cat: "warmup", tol: "exact", note: "Standardised from St Andrews." },
  { id: "chess-pieces", q: "How many pieces are in a chess set?", a: 32, unit: "pieces", cat: "warmup", tol: "exact", note: "16 per side." },

  // ---- world: geography and global counts ----
  { id: "un", q: "How many member states does the United Nations have?", a: 193, unit: "states", cat: "world", tol: "exact", note: "South Sudan was the last to join, in 2011." },
  { id: "africa", q: "How many sovereign countries are in Africa?", a: 54, unit: "countries", cat: "world", tol: "exact", note: "54 UN members." },
  { id: "south-america", q: "How many sovereign countries are in South America?", a: 12, unit: "countries", cat: "world", tol: "exact", note: "French Guiana is a French territory, not a country." },
  { id: "eu", q: "How many member states does the EU have?", a: 27, unit: "states", cat: "world", tol: "exact", note: "28 before the UK left in 2020." },
  { id: "nato", q: "How many member countries does NATO have?", a: 32, unit: "countries", cat: "world", tol: "exact", note: "Sweden became the 32nd in 2024." },
  { id: "commonwealth", q: "How many member states does the Commonwealth have?", a: 56, unit: "states", cat: "world", tol: "exact", note: "Gabon and Togo joined in 2022." },
  { id: "japan-pref", q: "How many prefectures does Japan have?", a: 47, unit: "prefectures", cat: "world", tol: "exact", note: "Including Tokyo, Hokkaido, Osaka, and Kyoto." },
  { id: "russia-tz", q: "How many time zones does Russia span?", a: 11, unit: "time zones", cat: "world", tol: "exact", note: "From UTC+2 to UTC+12." },
  { id: "everest", q: "How tall is Mount Everest in metres?", a: 8849, unit: "m", cat: "world", tol: "approx", note: "8,848.86 m by the 2020 China-Nepal joint survey." },
  { id: "kilimanjaro", q: "How tall is Mount Kilimanjaro in metres?", a: 5895, unit: "m", cat: "world", tol: "exact", note: "Uhuru Peak, the highest point in Africa." },
  { id: "fuji", q: "How tall is Mount Fuji in metres?", a: 3776, unit: "m", cat: "world", tol: "exact", note: "Japan's highest mountain." },
  { id: "earth-circ", q: "What is Earth's circumference at the equator in km?", a: 40075, unit: "km", cat: "world", tol: "approx", note: "40,075 km; a bit less around the poles." },
  { id: "nile", q: "How long is the Nile in km?", a: 6650, unit: "km", cat: "world", tol: "approx", note: "Commonly cited as about 6,650 km; the exact source is disputed." },
  { id: "great-wall", q: "What is the total length of all sections of the Great Wall of China in km?", a: 21196, unit: "km", cat: "world", tol: "approx", note: "21,196 km by the 2012 Chinese state survey, all dynasties combined." },
  { id: "indonesia", q: "Roughly how many islands does Indonesia have?", a: 17000, unit: "islands", cat: "world", tol: "approx", note: "Official counts have ranged from about 17,000 to 17,500 depending on the survey." },
  { id: "languages", q: "Roughly how many living languages are spoken in the world?", a: 7100, unit: "languages", cat: "world", tol: "approx", note: "Ethnologue counts a little over 7,100." },
  { id: "deep", q: "How deep is the deepest point in the ocean in metres?", a: 10935, unit: "m", cat: "world", tol: "approx", note: "Challenger Deep in the Mariana Trench; surveys put it between 10,920 and 10,935 m." },
  { id: "uk-area", q: "What is the land area of the UK in km²?", a: 243600, unit: "km²", cat: "world", tol: "approx", note: "About 243,600 km² including inland water." },
  { id: "india-area", q: "What is the area of India in km²?", a: 3287000, unit: "km²", cat: "world", tol: "approx", note: "3,287,263 km² by official figures." },
  { id: "india-pop", q: "What was India's population in 2023?", a: 1430000000, unit: "people", cat: "world", tol: "approx", note: "About 1.43 billion by UN estimates, overtaking China that year." },
  { id: "london-ny", q: "How far is London from New York in km (great-circle)?", a: 5570, unit: "km", cat: "world", tol: "approx", note: "About 5,570 km, roughly a seven-hour flight." },
  { id: "burj", q: "How tall is the Burj Khalifa in metres?", a: 828, unit: "m", cat: "world", tol: "exact", note: "828 m architectural height." },
  { id: "eiffel", q: "How tall is the Eiffel Tower in metres (including the antenna)?", a: 330, unit: "m", cat: "world", tol: "approx", note: "330 m since a new antenna was fitted in 2022; 324 m before that." },
  { id: "esb", q: "How many floors does the Empire State Building have?", a: 102, unit: "floors", cat: "world", tol: "exact", note: "The observation deck is on the 102nd." },

  // ---- london ----
  { id: "tube-stations", q: "How many stations does the London Underground serve?", a: 272, unit: "stations", cat: "london", tol: "exact", note: "272 stations across 11 lines." },
  { id: "tube-lines", q: "How many lines does the London Underground have?", a: 11, unit: "lines", cat: "london", tol: "exact", note: "The Elizabeth line and DLR are not counted as Underground lines." },
  { id: "tube-km", q: "How long is the London Underground network in km?", a: 402, unit: "km", cat: "london", tol: "approx", note: "About 402 km (250 miles) of route." },
  { id: "tube-journeys", q: "Roughly how many journeys are made on the Underground each year?", a: 1200000000, unit: "journeys", cat: "london", tol: "approx", note: "Around 1.2 billion a year; it peaked at 1.35 billion before the pandemic." },
  { id: "boroughs", q: "How many London boroughs are there (not counting the City of London)?", a: 32, unit: "boroughs", cat: "london", tol: "exact", note: "32 boroughs plus the City." },
  { id: "shard", q: "How tall is The Shard in metres?", a: 310, unit: "m", cat: "london", tol: "approx", note: "309.6 m, the tallest building in the UK." },
  { id: "thames", q: "How long is the River Thames in km?", a: 346, unit: "km", cat: "london", tol: "exact", note: "From Thames Head in Gloucestershire to the estuary." },
  { id: "london-pop", q: "What was London's population at the 2021 census?", a: 8800000, unit: "people", cat: "london", tol: "approx", note: "8,799,728 for Greater London." },
  { id: "heathrow", q: "How many passengers did Heathrow handle in 2023?", a: 79200000, unit: "passengers", cat: "london", tol: "approx", note: "79.2 million, per Heathrow's own figures." },
  { id: "wembley", q: "What is the capacity of Wembley Stadium?", a: 90000, unit: "seats", cat: "london", tol: "exact", note: "The largest stadium in the UK." },
  { id: "pl-clubs", q: "How many clubs are in the Premier League?", a: 20, unit: "clubs", cat: "london", tol: "exact", note: "Since it shrank from 22 in 1995." },
  { id: "imperial", q: "Roughly how many students does Imperial College London have?", a: 22000, unit: "students", cat: "london", tol: "approx", note: "A little over 22,000 across undergraduate and postgraduate." },

  // ---- body: human biology ----
  { id: "bones", q: "How many bones does an adult human have?", a: 206, unit: "bones", cat: "body", tol: "exact", note: "Babies start with around 270; many fuse." },
  { id: "foot-bones", q: "How many bones are in one human foot?", a: 26, unit: "bones", cat: "body", tol: "exact", note: "Plus 33 joints and over 100 muscles, tendons, and ligaments." },
  { id: "chromosomes", q: "How many chromosomes are in a normal human cell?", a: 46, unit: "chromosomes", cat: "body", tol: "exact", note: "23 pairs." },
  { id: "rbc", q: "How many days does a red blood cell live?", a: 120, unit: "days", cat: "body", tol: "approx", note: "About 120 days before the spleen recycles it." },
  { id: "blood", q: "How many litres of blood does an average adult have?", a: 5, unit: "litres", cat: "body", tol: "approx", note: "About 5 litres, more for larger people." },
  { id: "neurons", q: "How many neurons are in the human brain?", a: 86000000000, unit: "neurons", cat: "body", tol: "approx", note: "About 86 billion, per Herculano-Houzel's cell counts." },
  { id: "cells", q: "How many cells are in the human body?", a: 37000000000000, unit: "cells", cat: "body", tol: "approx", note: "About 37 trillion, per the 2013 estimate by Bianconi et al." },
  { id: "genome", q: "How many base pairs are in the human genome?", a: 3100000000, unit: "base pairs", cat: "body", tol: "approx", note: "About 3.1 billion in a haploid set." },
  { id: "muscles", q: "Roughly how many skeletal muscles does the human body have?", a: 600, unit: "muscles", cat: "body", tol: "approx", note: "Around 600, depending on how you count." },
  { id: "heart-rate", q: "What is a typical adult resting heart rate in beats per minute?", a: 70, unit: "bpm", cat: "body", tol: "approx", note: "60 to 100 is normal; 70 is a typical midpoint." },
  { id: "hair", q: "Roughly how many hairs are on a human head?", a: 100000, unit: "hairs", cat: "body", tol: "approx", note: "About 100,000, fewer for redheads and more for blondes." },
  { id: "taste", q: "Roughly how many taste buds does an adult have?", a: 10000, unit: "taste buds", cat: "body", tol: "approx", note: "Estimates range from 2,000 to 10,000; the commonly quoted figure is 10,000." },

  // ---- science: physics, space, nature ----
  { id: "elements", q: "How many elements are in the periodic table?", a: 118, unit: "elements", cat: "science", tol: "exact", note: "Oganesson is number 118." },
  { id: "light", q: "What is the speed of light in km per second?", a: 299792, unit: "km/s", cat: "science", tol: "exact", note: "299,792.458 km/s, exactly, by definition of the metre." },
  { id: "moon-dist", q: "How far is the Moon from Earth on average, in km?", a: 384400, unit: "km", cat: "science", tol: "approx", note: "384,400 km mean distance." },
  { id: "sun-dist", q: "How far is the Sun from Earth on average, in km?", a: 149600000, unit: "km", cat: "science", tol: "approx", note: "One astronomical unit, 149.6 million km." },
  { id: "moon-diam", q: "What is the diameter of the Moon in km?", a: 3474, unit: "km", cat: "science", tol: "approx", note: "3,474 km, about a quarter of Earth's." },
  { id: "earth-age", q: "How old is the Earth in millions of years?", a: 4540, unit: "million years", cat: "science", tol: "approx", note: "4.54 billion years, from radiometric dating of meteorites." },
  { id: "water-k", q: "What is the boiling point of water in kelvin at sea level?", a: 373, unit: "K", cat: "science", tol: "approx", note: "373.15 K." },
  { id: "gold", q: "What is the atomic number of gold?", a: 79, unit: "", cat: "science", tol: "exact", note: "Au, 79 protons." },
  { id: "iss", q: "How high above Earth does the ISS orbit, in km?", a: 400, unit: "km", cat: "science", tol: "approx", note: "Roughly 400 km, drifting between 370 and 460." },
  { id: "light-year", q: "How many km are in a light year?", a: 9461000000000, unit: "km", cat: "science", tol: "approx", note: "About 9.46 trillion km." },
  { id: "cheetah", q: "What is a cheetah's top speed in km/h?", a: 110, unit: "km/h", cat: "science", tol: "approx", note: "Measured runs land between 100 and 120 km/h." },
  { id: "blue-whale", q: "How much does a large blue whale weigh in tonnes?", a: 150, unit: "tonnes", cat: "science", tol: "approx", note: "Typically 100 to 150 tonnes; the largest recorded approached 190." },
  { id: "beetles", q: "How many beetle species have been described?", a: 400000, unit: "species", cat: "science", tol: "approx", note: "About 400,000, roughly a quarter of all named animals." },
  { id: "hours-year", q: "How many hours are in a non-leap year?", a: 8760, unit: "hours", cat: "science", tol: "exact", note: "365 × 24." },
  { id: "minutes-week", q: "How many minutes are in a week?", a: 10080, unit: "minutes", cat: "science", tol: "exact", note: "7 × 24 × 60." },

  // ---- business and culture ----
  { id: "mcd", q: "How many McDonald's restaurants were there worldwide at the end of 2023?", a: 41800, unit: "restaurants", cat: "business", tol: "approx", note: "41,822 per the company's 2023 annual report." },
  { id: "starbucks", q: "How many Starbucks stores were there worldwide at the end of fiscal 2024?", a: 40000, unit: "stores", cat: "business", tol: "approx", note: "Just over 40,000, per Starbucks' fiscal 2024 results." },
  { id: "wiki", q: "Roughly how many articles does English Wikipedia have (2025)?", a: 7000000, unit: "articles", cat: "business", tol: "approx", note: "About 7 million; it passed 6 million in 2020." },
  { id: "fifa", q: "How many member associations does FIFA have?", a: 211, unit: "associations", cat: "business", tol: "exact", note: "More than the UN has member states." },
  { id: "f1", q: "How many races were on the 2025 Formula 1 calendar?", a: 24, unit: "races", cat: "business", tol: "exact", note: "A record-equalling 24-race season." },
  { id: "slams", q: "How many Grand Slam tennis tournaments are held each year?", a: 4, unit: "tournaments", cat: "business", tol: "exact", note: "Australian Open, Roland Garros, Wimbledon, US Open." },
  { id: "nobel", q: "How many Nobel Prize categories are awarded each year?", a: 6, unit: "categories", cat: "business", tol: "exact", note: "Five original prizes plus the economics prize added in 1969." },
  { id: "beethoven", q: "How many symphonies did Beethoven complete?", a: 9, unit: "symphonies", cat: "business", tol: "exact", note: "The Ninth premiered in 1824." },
  { id: "sonnets", q: "How many sonnets did Shakespeare publish?", a: 154, unit: "sonnets", cat: "business", tol: "exact", note: "In the 1609 quarto." },
  { id: "india-states", q: "How many states does India have?", a: 28, unit: "states", cat: "business", tol: "exact", note: "28 states and 8 union territories since 2020." },
  { id: "india-langs", q: "How many languages are in the Eighth Schedule of India's constitution?", a: 22, unit: "languages", cat: "business", tol: "exact", note: "22 scheduled languages." },
  { id: "mumbai-pop", q: "What was the population of Mumbai city at the 2011 census?", a: 12400000, unit: "people", cat: "business", tol: "approx", note: "12.44 million within municipal limits; the metro area is far larger." },
  { id: "keyboard", q: "How many keys are on a full-size US keyboard?", a: 104, unit: "keys", cat: "business", tol: "approx", note: "104 for the standard ANSI layout with a numpad." }
];

window.QUANTEST_UNITS = [
  { id: "warmup", title: "Warm-up", blurb: "Numbers you half-know. Learn the quote mechanics.", color: "var(--bid)", dark: "var(--bid-dark)", lessons: 3 },
  { id: "world", title: "The world", blurb: "Geography and global counts. Width is your uncertainty.", color: "var(--brand)", dark: "var(--brand-dark)", lessons: 5 },
  { id: "london", title: "London", blurb: "Home turf. Tighter markets expected.", color: "var(--grape)", dark: "var(--grape-dark)", lessons: 4 },
  { id: "body", title: "The body", blurb: "Biology counts across ten orders of magnitude.", color: "var(--ask)", dark: "var(--ask-dark)", lessons: 4 },
  { id: "science", title: "Science and space", blurb: "Physical constants and distances.", color: "var(--gold)", dark: "var(--gold-dark)", lessons: 5 },
  { id: "business", title: "Business and culture", blurb: "Consulting-interview territory.", color: "var(--flame)", dark: "var(--flame-dark)", lessons: 4 }
];
