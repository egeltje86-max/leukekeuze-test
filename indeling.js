/* Spooksite LeukeKeuze – de categorieboom (stap 1 van HET PLAN, 3-11-2026).
   10 afdelingen > hooguit 10 groepen > hooguit 10 vakjes. Vakjes zijn PRODUCTSOORTEN.
   Voor wie, leeftijd, prijs, gelegenheid en thema (christelijk, met naam, grappig) zijn FILTERS, geen vakjes. */
window.SPOOK_INDELING_VERSIE = '2026-11-04-plan-tanden';
window.SPOOK_INDELING = [
  { id: 'speelgoed-spellen', naam: 'Speelgoed & spellen', groepen: [
    { naam: 'Baby & peuter', vakjes: ['Rammelaars & bijtringen', 'Babygyms & activiteitenspeelgoed', 'Stapelen & sorteren', 'Loopwagens & duwspeelgoed', 'Badspeelgoed'] },
    { naam: 'Bouwen', vakjes: ['LEGO', 'LEGO Duplo', 'Andere bouwstenen', 'Magnetisch bouwen', 'Knikkerbanen'] },
    { naam: 'Poppen & knuffels', vakjes: ['Babypoppen', 'Modepoppen', 'Poppenhuizen & accessoires', 'Knuffels', 'Squishmallows'] },
    { naam: 'Speelfiguren & voertuigen', vakjes: ['Playmobil', 'Dieren- & dinofiguren', 'Actiefiguren & superhelden', "Speelgoedauto's & garages", 'Racebanen & treinen', 'Radiografisch bestuurbaar'] },
    { naam: 'Rollenspel & verkleden', vakjes: ['Speelkeukens & winkeltjes', 'Gereedschap & dokterssets', 'Verkleedkleding'] },
    { naam: 'Knutselen', vakjes: ['Knutselsets', 'Klei & slijm', 'Tekenen & kleuren', 'Strijkkralen & sieraden maken'] },
    { naam: 'Leren & ontdekken', vakjes: ['Experimenteren & wetenschap', 'Programmeren & robots', 'Microscopen & telescopen', 'Tiptoi & leersystemen', 'Luisterboxen (Toniebox)', 'Muziekspeelgoed & karaoke'] },
    { naam: 'Buiten spelen', vakjes: ['Steps & loopfietsen', 'Trampolines & speeltoestellen', 'Zand & water', 'Buitenspellen & ballen'] },
    { naam: 'Spellen', vakjes: ['Bordspellen voor het gezin', 'Strategiespellen', 'Kaart- & dobbelspellen', 'Partyspellen', 'Escape room & breinbrekers', 'Kinderspellen', 'Verzamelkaarten (Pokémon)'] },
    { naam: 'Puzzels', vakjes: ['Legpuzzels', '3D-puzzels', 'Kinderpuzzels'] }
  ] },
  { id: 'elektronica-gaming', naam: 'Elektronica & gaming', groepen: [
    { naam: 'Audio', vakjes: ['Koptelefoons', 'Oordopjes', 'Bluetooth-speakers', 'Platenspelers'] },
    { naam: 'Gaming', vakjes: ['Consoles', 'Games', 'Controllers & accessoires', 'Gaming-headsets', 'Gamestoelen'] },
    { naam: 'Smartwatches', vakjes: ['Smartwatches', 'Activity trackers'] },
    { naam: 'Foto & video', vakjes: ["Camera's & instant camera's", "Actioncam's", 'Drones'] },
    { naam: 'Tablets & e-readers', vakjes: ['Tablets', 'E-readers', 'Powerbanks & opladers'] },
    { naam: 'Tv & beeld', vakjes: ['Televisies', 'Beamers', 'Soundbars'] },
    { naam: 'Slim wonen', vakjes: ['Slimme lampen & sfeerlicht', 'Slimme speakers', 'Robotstofzuigers'] },
    { naam: 'Gadgets', vakjes: ['Handige gadgets', 'Fun & retro gadgets'] }
  ] },
  { id: 'mode-sieraden', naam: 'Mode & sieraden', groepen: [
    { naam: 'Sieraden', vakjes: ['Kettingen', 'Armbanden', 'Oorbellen', 'Ringen', 'Sieraden met naam', 'Sieradendozen'] },
    { naam: 'Horloges', vakjes: ['Dameshorloges', 'Herenhorloges'] },
    { naam: 'Tassen & portemonnees', vakjes: ['Handtassen', 'Rugzakken', 'Portemonnees & pasjeshouders'] },
    { naam: 'Accessoires', vakjes: ['Sjaals & mutsen', 'Handschoenen', 'Zonnebrillen', 'Riemen & petten'] },
    { naam: 'Kleding', vakjes: ["Pyjama's & badjassen", 'Truien & hoodies', 'T-shirts met print', 'Sokken'] },
    { naam: 'Schoenen & sloffen', vakjes: ['Pantoffels & sloffen', 'Sneakers'] }
  ] },
  { id: 'beauty-verzorging', naam: 'Beauty & verzorging', groepen: [
    { naam: 'Parfum', vakjes: ['Damesparfum', 'Herenparfum', 'Parfumsets'] },
    { naam: 'Giftsets', vakjes: ['Giftsets voor haar', 'Giftsets voor hem'] },
    { naam: 'Bad & douche', vakjes: ['Bad- & doucheproducten', 'Bruisballen'] },
    { naam: 'Huid & gezicht', vakjes: ['Gezichtsverzorging', 'Lichaamsverzorging'] },
    { naam: 'Make-up & nagels', vakjes: ['Make-up', 'Nagels'] },
    { naam: 'Haar', vakjes: ['Föhns & stijltangen', 'Haarverzorging'] },
    { naam: 'Scheren & baard', vakjes: ['Scheerapparaten & trimmers', 'Baardverzorging'] },
    { naam: 'Mond & tanden', vakjes: ['Elektrische tandenborstels', 'Monddouches & flossers'] },
    { naam: 'Wellness', vakjes: ['Massage', 'Spa & ontspanning'] }
  ] },
  { id: 'wonen-koken', naam: 'Wonen & koken', groepen: [
    { naam: 'Woondecoratie', vakjes: ['Beelden & decoratie', 'Vazen', 'Wanddecoratie & posters', 'Klokken'] },
    { naam: 'Kaarsen & geur', vakjes: ['Kaarsen', 'Geurkaarsen', 'Geurstokjes', 'Kandelaars & lantaarns'] },
    { naam: 'Verlichting', vakjes: ['Sfeerlampen', 'Tafellampen', 'Lichtsnoeren'] },
    { naam: 'Plaids & kussens', vakjes: ['Plaids', 'Kussens', 'Kruiken & warmte'] },
    { naam: 'Foto & persoonlijk', vakjes: ['Fotoboeken', 'Foto op canvas & glas', 'Fotolijsten'] },
    { naam: 'Kerstdecoratie', vakjes: ['Kerstballen & hangers', 'Kerstverlichting', 'Kerststallen', 'Kerstfiguren'] },
    { naam: 'Koken & bakken', vakjes: ['Pannen & messen', 'Keukenapparaten', 'Bakken'] },
    { naam: 'Koffie & thee zetten', vakjes: ['Koffiemachines', 'Mokken & theeglazen', 'Theepotten'] },
    { naam: 'Tafelen', vakjes: ['Servies', 'Glazen', 'Borrelplanken & serveren'] }
  ] },
  { id: 'eten-drinken', naam: 'Eten & drinken', groepen: [
    { naam: 'Chocolade & snoep', vakjes: ['Chocolade', 'Snoep & drop', 'Chocoladeletters'] },
    { naam: 'Cadeaupakketten', vakjes: ['Cadeaupakketten & manden', 'Brievenbuscadeaus'] },
    { naam: 'Koffie, thee & cacao', vakjes: ['Koffie', 'Thee', 'Warme chocolademelk'] },
    { naam: 'Delicatessen', vakjes: ['Kaas & worst', 'Sauzen & kruiden', 'Noten & zoutjes'] },
    { naam: 'Wijn', vakjes: ['Rode wijn', 'Witte wijn', 'Rosé', 'Port & dessertwijn'] },
    { naam: 'Bubbels', vakjes: ['Champagne', 'Prosecco & cava'] },
    { naam: 'Bier', vakjes: ['Speciaalbier', 'Bierpakketten'] },
    { naam: 'Sterke drank', vakjes: ['Whisky', 'Gin', 'Rum', 'Likeur', 'Cognac', 'Wodka', 'Tequila', 'Jenever'] },
    { naam: 'Alcoholvrij', vakjes: ['Alcoholvrije wijn & bier', 'Siropen & mocktails'] },
    { naam: 'Drankaccessoires', vakjes: ['Glazen & karaffen', 'Cocktailsets', 'Wijnaccessoires'] }
  ] },
  { id: 'hobby-creatief', naam: 'Hobby & creatief', groepen: [
    { naam: 'Handwerken', vakjes: ['Haken & breien', 'Naaien', 'Borduren & punch needle', 'Diamond painting'] },
    { naam: 'Schilderen & tekenen', vakjes: ['Verf & schildersets', 'Tekenen & schetsen', 'Kalligrafie & handlettering'] },
    { naam: 'Zelf maken', vakjes: ['Kaarsen & zeep maken', 'Sieraden maken', 'Klei & epoxy'] },
    { naam: 'Modelbouw', vakjes: ['Bouwpakketten', 'Miniatuurhuisjes', 'Modeltreinen'] },
    { naam: 'Muziek maken', vakjes: ["Gitaren & ukelele's", "Keyboards & piano's", 'Muziekaccessoires'] },
    { naam: 'Papier & planners', vakjes: ["Agenda's & planners", 'Notitieboeken', 'Bullet journal'] }
  ] },
  { id: 'sport-buiten-tuin', naam: 'Sport, buiten & tuin', groepen: [
    { naam: 'Fietsen & steps', vakjes: ['Fietsaccessoires', 'Fietshelmen', 'Elektrische steps'] },
    { naam: 'Fitness & yoga', vakjes: ['Fitness thuis', 'Yoga & pilates'] },
    { naam: 'Wandelen & hardlopen', vakjes: ['Wandelen', 'Hardlopen'] },
    { naam: 'Kamperen & outdoor', vakjes: ['Kampeerspullen', 'Zaklampen & hoofdlampen', 'Messen & multitools', 'Verrekijkers'] },
    { naam: 'Balsport & spel', vakjes: ['Voetbal', 'Padel & tennis', 'Darts', 'Tafelvoetbal & tafeltennis'] },
    { naam: 'Zwemmen & wintersport', vakjes: ['Zwemmen', 'Wintersport'] },
    { naam: 'Tuin', vakjes: ['Tuindecoratie', 'Planten & zaden', 'Vogelhuisjes & insectenhotels', 'BBQ & buitenkoken', 'Vuurkorven'] },
    { naam: 'Klussen', vakjes: ['Gereedschap', 'Gereedschapssets'] }
  ] },
  { id: 'boeken-films-muziek', naam: 'Boeken, films & muziek', groepen: [
    { naam: 'Boeken', vakjes: ['Romans & thrillers', 'Kookboeken', 'Non-fictie & hobby', 'Strips & manga', 'Invulboeken & dagboeken', 'Puzzelboeken', 'Bijbels & christelijke boeken'] },
    { naam: 'Kinderboeken', vakjes: ['Prentenboeken', 'Voorleesboeken', 'Leesboeken', 'Kleurboeken'] },
    { naam: 'Films & series', vakjes: ['Dvd & Blu-ray'] },
    { naam: 'Muziek', vakjes: ['Vinyl', "Cd's"] }
  ] },
  { id: 'dieren', naam: 'Dieren', groepen: [
    { naam: 'Hond', vakjes: ['Hondenspeelgoed', 'Manden & kussens', 'Riemen & halsbanden'] },
    { naam: 'Kat', vakjes: ['Kattenspeelgoed', 'Krabpalen & manden'] },
    { naam: 'Klein dier', vakjes: ['Konijn & knaagdier'] },
    { naam: 'Vogels & vissen', vakjes: ['Vogels', 'Aquarium'] },
    { naam: 'Paard', vakjes: ['Paardrijden'] }
  ] }
];
/* Producten die al vastgelegd zijn (Claude zet hier jouw opgeslagen bestand in). */
window.SPOOK_PRODUCTEN = window.SPOOK_PRODUCTEN || [];
