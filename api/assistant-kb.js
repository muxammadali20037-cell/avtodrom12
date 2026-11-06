/* AI YORDAMCHI — bilim bazasi (faqat dastur qanday ishlashi; hech qanday ma'lumot/parol yo'q) */
export const KB = [
  /* ===================== KIRISH ===================== */
  {
    id: "tizimga-kirish",
    title: "Saytga kirish (kirish kodi, login va parol)",
    keys: ["kirish", "tizimga kirish", "saytga kirish", "dasturga kirish", "saytni ochish", "dasturni ochish", "kirolmayapman", "kira olmayapman", "login", "parol", "kirish kodi", "kod so'rayapti", "kod soryapti", "raqamlar chiqdi", "xush kelibsiz", "tizimdan chiqish", "chiqish tugmasi", "logout"],
    who: "hamma",
    where: "Sayt ochilganda — «Kirish kodi» oynasi, keyin «Xush kelibsiz» oynasi",
    page: null,
    text: "Sayt ochilganda avval **kirish kodi** so'raladi (kodni rahbardan so'rang). Keyin login va parol bilan kirasiz.",
    steps: [
      "Ekrandagi raqam tugmalari bilan kirish kodini tering va «Kirish» ni bosing.",
      "«Login» va «Parol» maydonlarini to'ldiring.",
      "«Kirish» ni bosing — «Yangi avtomobil» sahifasi ochiladi.",
      "Ish tugaganda tepadagi «Chiqish» tugmasi bilan tizimdan chiqasiz."
    ],
    tips: [
      "Login bir marta kiritilsa shu kompyuterda saqlanadi — keyingi safar faqat kirish kodi so'raladi.",
      "Kod 5 marta xato terilsa biroz kutish kerak (1 daqiqa, ko'p xatoda 10 daqiqa).",
      "Internet yo'q paytda faqat shu kompyuterda avval to'g'ri terilgan kod bilan kirsa bo'ladi.",
      "Kod, login yoki parol esdan chiqsa — rahbarga murojaat qiling."
    ],
    related: ["kod-unutildi", "post", "yangi-kassir", "muammo-sessiya"]
  },
  {
    id: "kod-unutildi",
    title: "Kirish kodi, login yoki parol esdan chiqsa",
    keys: ["kod esdan chiqdi", "kodni unutdim", "kirish kodini unutdim", "loginni unutdim", "parolni unutdim", "parol esimda yoq", "login esimda yoq", "kod notogri", "kirish kodi notogri", "login yoki parol notogri", "parol notogri", "kod nechchi", "kod qanaqa", "unutdim", "unutib qoydim", "kirisholmayapman"],
    who: "hamma",
    where: "Kirish oynasi",
    page: null,
    text: "Kirish kodi, login va parol qiymatlarini yordamchi aytmaydi. Ularni faqat rahbar biladi va beradi.",
    steps: [
      "Rahbarga (Adminga) qo'ng'iroq qiling va kirish kodi yoki loginingizni so'rang.",
      "Kod o'zgargan bo'lsa — rahbar aytgan yangi kodni kirish oynasida tering.",
      "«Login yoki parol noto'g'ri» chiqsa — harflarni, katta-kichik harfni va klaviatura tilini (lotin) tekshirib qayta yozing."
    ],
    tips: [
      "Kod yoki parolni qog'ozga yozib, kassada ochiq qoldirmang.",
      "Maxsus bo'lim paroli — bu boshqa parol, u ham rahbarda."
    ],
    related: ["tizimga-kirish", "kirish-kodi-ozgartirish", "maxsus-parol"]
  },
  {
    id: "kim-nima",
    title: "Kassir va rahbar: kim nima qiladi",
    keys: ["kim nima qiladi", "kassir nima qiladi", "rahbar nima qiladi", "kassir vazifasi", "vazifalar", "huquq", "ruxsat", "kassirga ruxsat", "parolsiz", "kassir koradimi", "rahbar", "boshliq ishi"],
    who: "hamma",
    where: "Chap menyu",
    page: null,
    text: "Kassir parolsiz ishlaydi: «Yangi avtomobil», «QR chek», «Jarayonda», «Kutish rejimi», «Tugatish», «Muzlatilgan». Hisobot, Rasxod, Excel, Tarix, nazorat va boshqaruv — Maxsus parol bilan, ya'ni rahbar uchun.",
    steps: [],
    tips: [
      "Kassir: mashina kiritadi va chiqaradi, pul oladi, qarzni yopadi, davomat va QR chek chiqaradi.",
      "Rahbar: hisobotni ko'radi, xatoni to'g'rilaydi, xarajat yozadi, hisoblar, Telegram bot va kodlarni boshqaradi.",
      "Kassir xato qilsa — rahbarga aytadi, rahbar «To'g'rilash» bilan tuzatadi."
    ],
    related: ["maxsus", "togrilash", "hisobot"]
  },

  /* ===================== KASSA: KIRDI ===================== */
  {
    id: "kirdi",
    title: "Mashinani kiritish («Kirdi» — vaqt ochish)",
    keys: ["kirdi", "kirdi bosish", "vaqt ochish", "vaqt och", "mashina kiritish", "moshina kiritish", "mashina kirdi", "moshina kirdi", "yangi avtomobil", "yangi mashina", "mijoz keldi", "kiritaman", "kirgizish", "kirgizaman", "vaqt ochaman", "mashina qoshish", "raqam yozish", "oddiy mijoz kiritish"],
    who: "kassir",
    where: "Chap menyu → Yangi avtomobil",
    page: "add",
    text: "Oddiy (pullik) mijoz kelganda vaqt shu yerda ochiladi. Kirgach mashina pastdagi «Hozir ichkarida» ro'yxatiga tushadi va chek o'zi chiqadi.",
    steps: [
      "Chap menyudan «Yangi avtomobil» ni oching, tepada «Oddiy mijoz» tanlangan bo'lsin.",
      "«Mashina raqami yoki mijoz ismi» maydoniga raqamni yoki ismni yozing.",
      "«Necha vaqtga?» qatoridan vaqtni tanlang. Mijoz bilmasa — «Ochiq» qoldiring.",
      "Vaqt tanlangan bo'lsa «Pul» qatorida tanlang: «Naqd», «Terminal», «Klik» yoki «Keyin to'laydi».",
      "Yashil «Kirdi» tugmasini (yoki Enter) bosing."
    ],
    tips: [
      "Bir mijozni kun bo'yi bir xil nom bilan yozing — yozayotganda bugungi nomlar taklif qilinadi.",
      "Mashina hali ichkarida bo'lsa, «Kirdi» yangi yozuvni o'zi kutish rejimiga qo'yadi.",
      "«Qanday ishlaydi?» tugmasi qisqa yo'riqnomani ochadi."
    ],
    related: ["mijoz-turi", "necha-vaqt", "oldindan-tolov", "chiqdi", "chek"]
  },
  {
    id: "mijoz-turi",
    title: "Oddiy mijoz va avtoshkola o'quvchisi farqi",
    keys: ["oddiy mijoz", "avtoshkola oquvchisi", "avtoshkola o'quvchisi", "farqi", "farq nima", "platniy", "pullik", "bepul", "tekin", "qaysi birini tanlayman", "mijoz turi", "rejim", "avtoshkola", "maktab oquvchisi"],
    who: "kassir",
    where: "Yangi avtomobil → tepadagi «Oddiy mijoz» / «Avtoshkola o'quvchisi»",
    page: "add",
    text: "«Oddiy mijoz» — pullik: vaqt ochiladi, pul olinadi. «Avtoshkola o'quvchisi» — shartnoma bo'yicha bepul dars: vaqt ochilmaydi, faqat davomat yoziladi va chek chiqadi.",
    steps: [
      "«Yangi avtomobil» sahifasida tepadagi ikki tugmadan birini tanlang.",
      "Pullik mijoz — «Oddiy mijoz» (klaviaturada ← strelka).",
      "Avtoshkola o'quvchisi — «Avtoshkola o'quvchisi» (klaviaturada → strelka)."
    ],
    tips: [
      "Avtoshkola o'quvchisi pullik yursa — «Oddiy mijoz» orqali kiritiladi.",
      "Hisobotda ular alohida: «Platniy» va «Avtoshkola»."
    ],
    related: ["kirdi", "davomat", "qr-chek"]
  },
  {
    id: "necha-vaqt",
    title: "Necha vaqtga tanlash («Ochiq», 30 daq, 1 soat ...)",
    keys: ["necha vaqtga", "necha soat", "vaqt tanlash", "ochiq", "ochiq vaqt", "30 daqiqa", "30 daq", "yarim soat", "1 soat", "bir soat", "1,5 soat", "2 soat", "soatga ochish", "vaqtini bilmaydi", "qancha yurishini bilmaydi", "vaqti tugaganda", "ozi yopiladi"],
    who: "kassir",
    where: "Yangi avtomobil → «Necha vaqtga?»",
    page: "add",
    text: "Vaqt tugmalari: «Ochiq», «30 daq», «1 soat», «1,5 soat», «2 soat», «2,5 soat», «3 soat», «4 soat». Har tugma ostida narxi yozilgan.",
    steps: [
      "Mijoz qancha yurishini bilmasa — «Ochiq» ni qoldiring: pul chiqqanda yurgan vaqtiga qarab olinadi.",
      "Mijoz vaqtini aytsa (masalan 1 soat) — o'sha tugmani bosing.",
      "Vaqt tanlansa — vaqti tugaganda yozuv o'zi yopiladi; pul to'lanmagan bo'lsa «To'lanmagan» ro'yxatiga tushadi."
    ],
    tips: [
      "Buyurtma qilingan vaqtdan kam pul olinmaydi: 1 soat olib 40 daqiqada chiqsa ham 1 soat narxi.",
      "Tanlangan vaqt va narx «Kirdi» tugmasi yonida ko'rinib turadi."
    ],
    related: ["narx", "oldindan-tolov", "vaqt-tugadi", "kirdi"]
  },
  {
    id: "oldindan-tolov",
    title: "Oldindan to'lov yoki chiqqanda to'lov",
    keys: ["oldindan tolov", "oldindan to'lov", "oldin tolaydi", "oldin pul", "pulni oldin berdi", "chiqqanda tolaydi", "chiqishda tolaydi", "chiqishda", "pul keyin", "tolov turi", "to'lov turi", "pul qatori", "naqd", "terminal", "klik", "click", "karta"],
    who: "kassir",
    where: "Yangi avtomobil → «Pul» qatori",
    page: "add",
    text: "Vaqt «Ochiq» bo'lsa, pul faqat chiqqanda olinadi. Vaqt tanlangan bo'lsa (masalan 1 soat), pulni kirishda olish mumkin.",
    steps: [
      "Vaqtni tanlang (masalan «1 soat»).",
      "Pul berdimi — «Naqd», «Terminal» yoki «Klik» ni bosing.",
      "Hozir bermasa — «Keyin to'laydi» ni bosing.",
      "«Kirdi» ni bosing."
    ],
    tips: [
      "Oldindan to'lagan mijoz chiqqanda «Chiqdi — yopish» chiqadi, qo'shimcha pul so'ralmaydi.",
      "Vaqtdan oshib ketsa — chiqishda faqat qo'shimchasi so'raladi.",
      "«Ochiq» tanlanganda to'lov tugmalari ko'rinmaydi — bu to'g'ri."
    ],
    related: ["necha-vaqt", "keyin-tolaydi", "chiqdi", "narx"]
  },
  {
    id: "narx",
    title: "Narx qoidasi (30 daqiqa va 1 soat)",
    keys: ["narx", "narxi", "necha pul", "qancha turadi", "tarif", "soatiga", "30 daqiqa narxi", "1 soat narxi", "50000", "100000", "150000", "50 ming", "100 ming", "150 ming", "kechiriladi", "20 daqiqa", "40 daqiqa", "39 daqiqa", "ortiqcha vaqt", "narx qanday hisoblanadi", "nega bunday narx"],
    who: "hamma",
    where: "Narx «Chiqdi» oynasida o'zi hisoblanadi",
    page: "add",
    text: "Soatiga 100 000 so'm, vaqt 30 daqiqalik bo'laklarda: 39 daqiqagacha — 30 daqiqa (50 000 so'm), 40 daqiqa bo'ldimi — 1 soat (100 000 so'm). Narxni dastur o'zi hisoblaydi.",
    steps: [],
    tips: [
      "1 soatdan keyin 20 daqiqa kechiriladi: 1 soat 19 daqiqa ham 100 000 so'm.",
      "1 soat 20 daqiqadan oshdimi — 1,5 soat: 150 000 so'm. Keyingi har 30 daqiqada ham 20 daqiqagacha kechiriladi.",
      "Buyurtma qilingan vaqtdan kam olinmaydi: 2 soat olib 1 soatda chiqsa ham 2 soat narxi.",
      "Avtoshkola o'quvchisi (davomat) uchun pul olinmaydi."
    ],
    related: ["necha-vaqt", "chiqdi", "boshqa-chiqish", "mijoz-turi"]
  },
  {
    id: "bron",
    title: "Bron va «Boshqa vaqtda kirgan / bron»",
    keys: ["bron", "bron qilish", "oldindan yozish", "keyinroq keladi", "kechqurun keladi", "vaqtni oldindan", "boshqa vaqtda kirgan", "kirish vaqti", "kirish vaqtini ozgartirish", "oldin kirgan", "yozish esdan chiqdi", "kech yozdim", "otgan vaqt", "zakaz", "rezerv"],
    who: "kassir",
    where: "Yangi avtomobil → «Boshqa vaqtda kirgan / bron»",
    page: "add",
    text: "Kirish vaqtini qo'lda yozish uchun. Keyingi vaqt yozilsa — bron: o'sha vaqtda o'zi ochiladi. O'tgan vaqt yozilsa — mashina aslida kirgan vaqtdan hisoblanadi.",
    steps: [
      "Nom va vaqtni yozing.",
      "«Boshqa vaqtda kirgan / bron» ni bosing va «Kirish:» maydoniga soatni yozing.",
      "Vaqt keyinroq bo'lsa tugma «Bron qilish» bo'ladi — bosing, chek darhol chiqadi.",
      "Vaqt o'tgan bo'lsa — «Kirdi» ni bosing (tanlangan vaqt ham o'tib bo'lgan bo'lsa tugma «Yozish» bo'ladi va yozuv darhol yopiladi).",
      "Hozirgi vaqtga qaytish uchun «Hozir» ni bosing."
    ],
    tips: [
      "Faqat bugungi vaqtlar: 12 soatdan uzoq bron yoki 12 soatdan oldingi kirish yozilmaydi.",
      "Bron vaqti kelganda mashina band bo'lsa — u bo'shashini kutadi.",
      "Bron faqat internet bilan ishlaydi."
    ],
    related: ["navbat", "band-mashina", "kirdi"]
  },
  {
    id: "instruktor-biriktirish",
    title: "Instruktor biriktirish",
    keys: ["instruktor biriktirish", "instruktor tanlash", "instruktorni yozish", "instruktor ismi", "kim bilan uchdi", "kim bilan yurdi", "ustoz", "instruktor bilan keldi", "instruktor yozish", "instruktorni korsatish", "instruktorsiz"],
    who: "kassir",
    where: "Yangi avtomobil → «Instruktor biriktirish»",
    page: "add",
    text: "Mashina instruktor bilan kirsa, uni yozib qo'yish mumkin (ixtiyoriy). Bu «Xatoliklar va aniqliklar» nazorati uchun kerak.",
    steps: [
      "Oddiy mijozda «Instruktor biriktirish» havolasini bosing.",
      "Instruktor ismini yozing va ro'yxatdan tanlang.",
      "«Kirdi» ni bosing — kartada «Instruktor: …» ko'rinadi."
    ],
    tips: [
      "Avtoshkola o'quvchisida instruktor maydoni o'zi ko'rinadi, u ham ixtiyoriy.",
      "Ro'yxatda bo'lmasa ham yozilgan ism saqlanadi."
    ],
    related: ["instruktorlar", "nazorat", "kirdi"]
  },
  {
    id: "chek",
    title: "Chek chiqarish va qayta chiqarish",
    keys: ["chek", "chek chiqarish", "talon", "kirish taloni", "qayta chek", "chekni qayta", "qayta chiqarish", "chekni yana", "chop etish", "pechat", "print", "chek berish", "nusxa chek", "dublikat"],
    who: "kassir",
    where: "«Kirdi» bosilganda o'zi; qayta — Jarayonda → «Kirish taloni»",
    page: "active",
    text: "«Kirdi» bosilganda kirish cheki o'zi chop etiladi. Chekni yana chiqarish kerak bo'lsa — «Jarayonda» bo'limidagi mashina kartasidan.",
    steps: [
      "Chap menyudan «Jarayonda» ni oching.",
      "Kerakli mashinani toping (qidiruvga raqamini yozing).",
      "Kartadagi «Kirish taloni» tugmasini bosing.",
      "Ochilgan oynada «Chop etish — 80 mm» ni bosing."
    ],
    tips: [
      "«Kirish taloni» yangi oynada ochiladi — brauzer so'rasa, yangi oynalarga ruxsat bering.",
      "Bron yoki navbatga qo'yilganda ham chek darhol chiqadi.",
      "Avtoshkola o'quvchisiga chek «Davomat yozish + chek» yoki «QR chek» orqali chiqadi."
    ],
    related: ["muammo-chek", "jarayonda", "davomat", "qr-chek"]
  },
  {
    id: "klaviatura",
    title: "Klaviatura bilan tez ishlash",
    keys: ["klaviatura", "tez ishlash", "enter", "strelka", "sichqonchasiz", "mishkasiz", "tezkor tugmalar", "hotkey", "ctrl", "plyus minus"],
    who: "kassir",
    where: "Yangi avtomobil, QR chek, Excel",
    page: "add",
    text: "Ko'p ishni sichqonchasiz qilish mumkin: kursor o'zi kerakli maydonda turadi.",
    steps: [
      "Oddiy mijoz: nom yozing → Enter = «Kirdi».",
      "← strelka — «Oddiy mijoz», → strelka — «Avtoshkola o'quvchisi».",
      "O'quvchi: ism yozing → Enter tanlaydi → yana Enter = davomat + chek; + / − — darslar soni; ↓ ↑ — boshqa ism.",
      "QR chek: o'quvchini tanlab Enter — chek chiqadi.",
      "Excel: Ctrl+S — saqlash, Ctrl+Z — orqaga, Ctrl+Enter — yangi qator, Esc — yopish."
    ],
    tips: [],
    related: ["kirdi", "davomat", "excel-bolimi"]
  },

  /* ===================== KASSA: JARAYONDA VA CHIQDI ===================== */
  {
    id: "jarayonda",
    title: "«Jarayonda» bo'limi: ichkaridagi mashinalar va ogohlantirishlar",
    keys: ["jarayonda", "jarayondagi", "jarayondagilar", "ichkaridagilar", "hozir avtodromda", "vaqti tugayapti", "qolgan vaqt", "ogohlantirish", "qizil", "sariq", "rang", "ranglar", "10 min", "20 min", "5 daqiqa qoldi", "filtr", "faol mashinalar", "kartalar"],
    who: "kassir",
    where: "Chap menyu → Jarayonda",
    page: "active",
    text: "Hozir avtodromdagi hamma mashinalar shu yerda, vaqti tugayotganlari eng tepada. Har kartada o'tgan va qolgan vaqt, boshlangan payt va hozircha narx ko'rinadi.",
    steps: [
      "Chap menyudan «Jarayonda» ni oching.",
      "Mashinani qidiruvga raqam, o'quvchi yoki instruktor ismini yozib toping.",
      "Filtrlar: «Barcha», «20 min ichida», «10 min ichida», «O'quvchi», «Oddiy mijoz».",
      "Kartadagi tugmalar: «Tugatish» (yopish va to'lov), «Kirish taloni» (chekni qayta chiqarish), «Muzlatish»."
    ],
    tips: [
      "Sariq — 20 daqiqadan kam qoldi; qizil — 10 daqiqadan kam; «Vaqt tugayapti — 5 daqiqadan kam qoldi!» — darhol qarang.",
      "«Belgilangan vaqt tugagan» — mashina vaqtidan oshgan.",
      "«Oddiy mijoz · oxirida to'laydi» — vaqt ochiq, pul chiqishda olinadi.",
      "Ro'yxat yangilanmasa — «Yangilash» tugmasini bosing."
    ],
    related: ["chiqdi", "muzlatish", "chek", "tozalash"]
  },
  {
    id: "chiqdi",
    title: "Mashina chiqdi: «Chiqdi» va to'lov turlari",
    keys: ["chiqdi", "chqdi", "chikdi", "chiqish", "chiqardim", "chiqaraman", "mashina chiqdi", "moshina chiqdi", "vaqtni yopish", "tolov olish", "pul olish", "tolash", "hozir ichkarida", "ichkarida", "naqd terminal klik", "qanday toladi"],
    who: "kassir",
    where: "Yangi avtomobil → «Hozir ichkarida» → «Chiqdi»",
    page: "add",
    text: "Mashina chiqqanda «Chiqdi» bosiladi: dastur qancha yurganini va narxini katta qilib ko'rsatadi. To'lov turini bosishingiz bilan pul yoziladi va vaqt yopiladi.",
    steps: [
      "«Yangi avtomobil» sahifasida pastdagi «Hozir ichkarida» ro'yxatidan mashinani toping (nomini yozsangiz, u tepaga chiqadi).",
      "Qatordagi yashil «Chiqdi» tugmasini bosing.",
      "Summani tekshiring va «Qanday to'ladi?» ostidan «Naqd», «Terminal» yoki «Klik» ni bosing.",
      "Hozir to'lamasa — «Keyin to'laydi — «To'lanmagan»ga yozish» ni bosing."
    ],
    tips: [
      "«Jarayonda» va «Tugatish» dagi «Tugatish» tugmasi ham xuddi shu oynani ochadi.",
      "Oldindan to'langan bo'lsa «Chiqdi — yopish» tugmasi chiqadi.",
      "Aralash to'lov yoki summani o'zgartirish — «Boshqa: chiqish vaqti, summa, aralash to'lov»."
    ],
    related: ["narx", "keyin-tolaydi", "boshqa-chiqish", "bir-qismini-yopish", "tugatish"]
  },
  {
    id: "keyin-tolaydi",
    title: "«Keyin to'laydi» — pulni keyinroq beradigan mijoz",
    keys: ["keyin tolaydi", "keyin to'laydi", "keyin beradi", "keyin tolayman", "qarzga", "qarzga yozish", "nasiya", "pul bermadi", "pulni keyin", "kun oxirida tolaydi", "hozir pul yoq", "tolanmaganga yozish"],
    who: "kassir",
    where: "«Chiqdi» oynasi yoki «Pul» qatori → «Keyin to'laydi»",
    page: "add",
    text: "Mijoz pulni hozir bermasa, summa «To'lanmagan» ro'yxatiga yoziladi. U pul berganda shu ro'yxatdan «To'lash» bilan yopiladi.",
    steps: [
      "Chiqishda: «Chiqdi» → «Keyin to'laydi — «To'lanmagan»ga yozish».",
      "Yoki kirishda: vaqtni tanlab, «Pul» qatorida «Keyin to'laydi» → «Kirdi». Vaqti tugaganda to'lanmagan bo'lib yopiladi.",
      "Mijoz pul berganda: «To'lanmagan» → «To'lash»."
    ],
    tips: [
      "Kun bo'yi bir necha marta kelsa, hammasi bir nom ostida jamlanadi va birdan to'lanadi.",
      "Shuning uchun mijoz nomini har safar bir xil yozing."
    ],
    related: ["qarz-tolash", "chiqdi", "oldindan-tolov"]
  },
  {
    id: "boshqa-chiqish",
    title: "Aralash to'lov, summani o'zgartirish, chiqish vaqtini qo'lda yozish",
    keys: ["aralash", "aralash tolov", "aralash to'lov", "yarmi naqd", "yarmi terminal", "naqd va karta", "summani ozgartirish", "summa ozgartirish", "chegirma", "skidka", "chiqish vaqti", "chiqish vaqtini ozgartirish", "kech yopdim", "vaqtida yopmadim", "chiqdini kech bosdim", "reja boyicha", "sessiyani yakunlash"],
    who: "kassir",
    where: "«Chiqdi» oynasi → «Boshqa: chiqish vaqti, summa, aralash to'lov»",
    page: "add",
    text: "To'liq yakunlash oynasi: mashina aslida chiqqan vaqtni yozish, summani o'zgartirish yoki pulni bir nechta turda olish uchun.",
    steps: [
      "Mashinada «Chiqdi» ni bosing.",
      "Pastdagi «Boshqa: chiqish vaqti, summa, aralash to'lov» ni bosing — «Sessiyani yakunlash» oynasi ochiladi.",
      "Kech yopayotgan bo'lsangiz «Chiqish vaqti» ga mashina aslida chiqqan vaqtni yozing (yoki «Reja bo'yicha»). Narx o'zi qayta hisoblanadi.",
      "«To'lov turi» dan «Naqd», «Terminal», «Klik» yoki «Aralash» ni tanlang; «Aralash» da har biriga qancha berganini yozing.",
      "Kerak bo'lsa «To'lov summasi (so'm)» ni o'zgartiring va «Yakunlash» ni bosing."
    ],
    tips: [
      "Chiqish vaqti hozirdan keyin yoki kirgan vaqtdan oldin bo'lishi mumkin emas.",
      "«Hozir» tugmasi vaqtni hozirgi daqiqaga qaytaradi."
    ],
    related: ["chiqdi", "narx", "togrilash", "tugatish"]
  },
  {
    id: "bir-qismini-yopish",
    title: "«Bir qismini yopish» — bir qismini to'lab, yurishni davom ettirish",
    keys: ["bir qismini yopish", "bir qismi", "qismini yopish", "qisman", "qisman tolov", "2 soatini yopaman", "bolib tolash", "bo'lib to'lash", "davom etadi", "oraliq tolov", "yarim yolda tolash"],
    who: "kassir",
    where: "«Chiqdi» oynasi → «Bir qismini yopish — qolgani davom etadi»",
    page: "add",
    text: "Vaqti ochiq mijoz yurib turib bir qismini (masalan 2 soatini) to'lasa ishlatiladi. Tanlangan qismi alohida yopiladi, qolgani o'sha paytdan davom etadi.",
    steps: [
      "Mashinada «Chiqdi» ni bosing.",
      "«Bir qismini yopish — qolgani davom etadi» ni bosing.",
      "«Necha soatini yopasiz?» dan vaqtni tanlang — yopiladigan oraliq va narx ko'rinadi.",
      "«Naqd», «Terminal», «Klik» yoki «Keyin to'laydi — «To'lanmagan»ga yozish» ni bosing."
    ],
    tips: [
      "Tugma faqat vaqti «Ochiq» va oldindan to'lanmagan mashinada chiqadi; kamida 30 daqiqa yurgan bo'lishi kerak.",
      "Faqat internet bilan ishlaydi; internet yo'q bo'lsa — to'liq «Chiqdi» qiling.",
      "Fikr o'zgarsa — «← Orqaga (to'liq chiqish)»."
    ],
    related: ["chiqdi", "narx", "keyin-tolaydi"]
  },
  {
    id: "vaqt-tugadi",
    title: "Vaqti tugaganda mashina o'zi yopildi",
    keys: ["ozi yopildi", "o'zi yopildi", "vaqti tugadi yopildi", "avtomatik yopildi", "royxatdan yoqoldi", "mashina yoqoldi", "yoqolib qoldi", "vaqt tugadi", "yopilmoqda", "nega yopildi"],
    who: "kassir",
    where: "Jarayonda / Hozir ichkarida",
    page: "active",
    text: "Vaqti tanlab ochilgan mashina (masalan 1 soat) vaqti tugaganda o'zi yopiladi va «Vaqti tugadi, yopildi» xabari chiqadi. Pul to'lanmagan bo'lsa — «To'lanmagan» ro'yxatiga tushadi.",
    steps: [
      "Mijoz to'lamagan bo'lsa: «Yangi avtomobil» → «To'lanmagan» → «To'lash».",
      "Mijoz yana yurmoqchi bo'lsa — yangi «Kirdi» qiling."
    ],
    tips: [
      "Vaqti «Ochiq» mashinalar o'zi yopilmaydi — ularni «Chiqdi» bilan yopasiz.",
      "«Hozir ichkarida» dagi «yopilmoqda…» — vaqt tugadi, bir ozdan keyin ro'yxatdan chiqadi."
    ],
    related: ["necha-vaqt", "qarz-tolash", "jarayonda"]
  },
  {
    id: "muzlatish",
    title: "Muzlatish va davom ettirish",
    keys: ["muzlatish", "muzlat", "muzlatilgan", "pauza", "toxtatish", "vaqtni toxtatish", "tanaffus", "davom ettirish", "davom ettir", "qayta boshlash", "freeze", "vaqt toxtasin"],
    who: "kassir",
    where: "Jarayonda → «Muzlatish»; Chap menyu → Muzlatilgan",
    page: "frozen",
    text: "Muzlatilgan mashinaning vaqti to'xtaydi va u «Muzlatilgan» ro'yxatiga o'tadi. Keyin vaqtni davom ettirish yoki yopish mumkin.",
    steps: [
      "«Jarayonda» bo'limida mashina kartasidagi «Muzlatish» ni bosing.",
      "Davom ettirish uchun chap menyudan «Muzlatilgan» ni oching.",
      "Mashinada «Davom ettirish» ni bosing — vaqt yana sanaladi.",
      "Yoki «Tugatish» ni bosib yoping va to'lovni yozing."
    ],
    tips: [
      "Muzlatilgan mashina band hisoblanadi — uning navbatdagisi boshlanmaydi.",
      "Muzlatilgandan yopilganda chiqish vaqtini qo'lda o'zgartirib bo'lmaydi."
    ],
    related: ["jarayonda", "tugatish", "navbat"]
  },
  {
    id: "tugatish",
    title: "«Tugatish» bo'limi",
    keys: ["tugatish", "tugatish bolimi", "yakunlash", "sessiyani yakunlash", "sessiya yopish", "tugat", "finish", "vaqtni tugatish", "darsni tugatish", "yopish"],
    who: "kassir",
    where: "Chap menyu → Tugatish",
    page: "finish",
    text: "Ichkaridagi hamma mashinalarni qidirib, yopish va to'lovni yozish joyi. Oddiy mijozda «Tugatish» tugmasi «Chiqdi» oynasini ochadi.",
    steps: [
      "Chap menyudan «Tugatish» ni oching.",
      "Qidiruvga raqam yoki ismni yozing.",
      "Kerakli kartada «Tugatish» ni bosing.",
      "To'lov turini tanlang yoki «Sessiyani yakunlash» oynasida «Yakunlash» ni bosing."
    ],
    tips: [
      "Avtoshkola o'quvchisi va muzlatilgan mashina «Sessiyani yakunlash» oynasida yopiladi; o'quvchi uchun «To'lovsiz».",
      "Oddiy mijozni tez yopish uchun «Yangi avtomobil» dagi «Hozir ichkarida» → «Chiqdi» qulay."
    ],
    related: ["chiqdi", "boshqa-chiqish", "muzlatish"]
  },

  /* ===================== NAVBAT / BAND / QARZ ===================== */
  {
    id: "navbat",
    title: "Kutish rejimi (navbat)",
    keys: ["navbat", "navbatga", "navbatga qoyish", "navbatga qo'yish", "kutish", "kutish rejimi", "kutishda", "kutyapti", "navbatdagi", "boshlash", "navbatdan chiqarish", "navbatni ochirish", "keyingi mijoz", "ketma-ket", "ochered"],
    who: "kassir",
    where: "Chap menyu → Kutish rejimi",
    page: "queue",
    text: "Bitta mashinaga bir nechta mijoz navbatda turishi mumkin. Ichkaridagi mashina chiqishi bilan navbatdagisi o'zi boshlanadi; bron — o'z vaqtida.",
    steps: [
      "«Yangi avtomobil» da nom va vaqtni yozing, so'ng «Navbatga qo'yish» ni bosing.",
      "Ro'yxatni ko'rish uchun chap menyudan «Kutish rejimi» ni oching.",
      "Mashina bo'sh bo'lsa, darhol boshlash uchun navbatdagida «Boshlash» ni bosing.",
      "Mijoz ketib qolsa — qizil ✕ tugmasini bosib «Chiqarish» ni tasdiqlang."
    ],
    tips: [
      "«KUTISHDA» — oldingisi chiqishini kutyapti; «BRON» — belgilangan vaqtni kutyapti.",
      "Navbat hamma kompyuterda bir xil ko'rinadi.",
      "Navbat va bron faqat internet bilan ishlaydi."
    ],
    related: ["band-mashina", "bron", "kirdi"]
  },
  {
    id: "band-mashina",
    title: "Mashina band (hali ichkarida) bo'lsa",
    keys: ["band", "band mashina", "mashina band", "moshina band", "ichkarida turibdi", "hali chiqmagan", "bosh emas", "ikkinchi mijoz", "bir mashinaga ikki", "navbatga tushib qoldi", "ozi navbatga", "kirdi bosdim navbatga tushdi"],
    who: "kassir",
    where: "Yangi avtomobil → «Kirdi»",
    page: "queue",
    text: "Shu raqamli mashina hali ichkarida bo'lsa, «Kirdi» yangi yozuvni o'zi kutish rejimiga qo'yadi. Ichkaridagi chiqishi («Chiqdi») bilan yangisi o'zi boshlanadi.",
    steps: [
      "Raqam va vaqtni yozib «Kirdi» ni bosing.",
      "«… hozir ichkarida — kutish rejimiga qo'yildi» xabari chiqadi, chek ham chiqadi.",
      "Oldingi mijoz chiqqanda «Chiqdi» ni bosing — navbatdagisi o'zi boshlanadi."
    ],
    tips: [
      "Boshlanganini «Navbatdagi o'zi boshlandi» xabari aytadi.",
      "Mashina ichkarida turganda o'tgan vaqtni yozib bo'lmaydi — avval ichkaridagini «Chiqdi» qiling."
    ],
    related: ["navbat", "muammo-jarayonda", "chiqdi"]
  },
  {
    id: "qarz-tolash",
    title: "To'lanmagan ro'yxati va qarzni to'lash",
    keys: ["qarz", "qarz tolash", "qarz to'lash", "qarz tulash", "qarzni tolash", "qarzni yopish", "tolanmagan", "to'lanmagan", "tulanmagan", "qarzdor", "pul olib keldi", "pulini berdi", "tolash", "tulash", "nasiya", "hammasi", "qancha toladi", "kam toladi", "kop toladi"],
    who: "kassir",
    where: "Yangi avtomobil → pastdagi «To'lanmagan» → «To'lash»",
    page: "add",
    text: "«Keyin to'laydi» bo'lganlar «To'lanmagan» ro'yxatida nom bo'yicha jamlanadi. Yozilgan summa aynan bugungi hisobotga tushadi va qarz to'liq yopiladi.",
    steps: [
      "«Yangi avtomobil» sahifasida pastdagi «To'lanmagan» ro'yxatidan mijozni toping (nomini yozsangiz tepaga chiqadi).",
      "«To'lash» ni bosing — har bir kirish-chiqish va jami summa ko'rinadi.",
      "«Qancha to'ladi?» maydoniga mijoz bergan summani yozing. To'liq qarz uchun «Hammasi» ni bosing.",
      "«Naqd», «Terminal» yoki «Klik» ni bosing."
    ],
    tips: [
      "Kam yoki ko'p summa yozilsa ham aynan o'sha summa hisobotga tushadi va qarz yopiladi — qoldiq qarz bo'lib qolmaydi.",
      "Oldingi kunlardagi qarz bugun to'lansa — bugungi hisobotda «Kechagi (qarzdan)» bo'lib chiqadi.",
      "Internet yo'q bo'lsa ham ishlaydi, keyin o'zi yuboriladi.",
      "To'langan qarz shu kunning tushumiga tushadi: Kunlik hisobotda «Jami», Excel'da pastda «QARZDAN TO'LANDI» va «BUGUNGI TUSHUM» qatorlari."
    ],
    related: ["keyin-tolaydi", "qarz-bekor", "kechagi", "hisobot"]
  },
  {
    id: "qarz-bekor",
    title: "Qarz to'lovini bekor qilish (xato «To'lash» bosilgan bo'lsa)",
    keys: ["qarz tolovini bekor qilish", "qarz to'lovini bekor", "tolovni bekor qilish", "tolovni qaytarish", "xato tolash", "xato toladim", "boshqa mijozni toladim", "notogri tolov turi", "klik emas naqd", "qarzni qaytarish"],
    who: "rahbar",
    where: "Maxsus bo'lim → Kunlik hisobot → qatordagi «To'g'rilash»",
    page: "daily",
    text: "Qarz noto'g'ri to'langan bo'lsa (boshqa mijoz yoki xato to'lov turi), to'lov bekor qilinadi va summa yana «To'lanmagan» ga qaytadi.",
    steps: [
      "Maxsus bo'limni oching va «Kunlik hisobot» ga kiring.",
      "Mashina qatorida «To'g'rilash» ni bosing — «qarzi to'langan» oynasi ochiladi.",
      "«Sababi» ga nima uchun bekor qilinayotganini yozing.",
      "«Qarz to'lovini bekor qilish» ni bosing.",
      "Keyin kassada «To'lanmagan» → «To'lash» orqali to'g'risini qiling."
    ],
    tips: [
      "Bugungi to'lov o'chiriladi; o'tgan kundagi to'lov o'z kunida qoladi, bugun minus yozuv tushadi.",
      "Sababsiz saqlanmaydi (kamida 5 harf)."
    ],
    related: ["qarz-tolash", "togrilash", "hisobot"]
  },

  /* ===================== AVTOSHKOLA ===================== */
  {
    id: "davomat",
    title: "Avtoshkola o'quvchisi: davomat yozish va chek",
    keys: ["davomat", "davomat yozish", "oquvchi", "o'quvchi", "dars yozish", "dars", "darslar soni", "necha dars", "1 soat 1 dars", "davomat chek", "cheksiz", "davomat yozish chek", "kurs", "oquvchi keldi", "talaba", "soat oraligi"],
    who: "kassir",
    where: "Yangi avtomobil → «Avtoshkola o'quvchisi»",
    page: "add",
    text: "Avtoshkola o'quvchisi uchun vaqt ochilmaydi: dars darhol davomatga yoziladi va chek chiqadi. 1 soat = 1 dars, pul olinmaydi.",
    steps: [
      "«Yangi avtomobil» da «Avtoshkola o'quvchisi» ni tanlang.",
      "«O'quvchini toping» maydoniga ism yoki guruh raqamini yozib o'quvchini tanlang (yoki «Guruh bo'yicha tanlash»).",
      "Instruktor va mashinani tanlang (ixtiyoriy).",
      "«Necha dars?» dan «1 soat», «2 soat» ... yoki «Soat oralig'i» ni tanlang.",
      "«Davomat yozish + chek» ni bosing. Printer ishlamasa — «Davomat yozish (cheksiz)»."
    ],
    tips: [
      "Bir yozuvda 2 tadan ko'p dars bo'lsa sababini yozish shart.",
      "O'quvchi kartasida jami va bugungi darslari ko'rinadi: 1–5 normal, 6–11 nazorat, 12+ yangi bosqich.",
      "Bepul limit tugagan bo'lsa tugma «Davomat yozish (chek chiqmaydi)» bo'ladi.",
      "Kirish muddati tugagan bo'lsa davomat yozilmaydi."
    ],
    related: ["oquvchi-qidiruv", "bepul-limit", "kirish-muddati", "qr-chek"]
  },
  {
    id: "oquvchi-qidiruv",
    title: "O'quvchini tez topish (ism, guruh, telefon)",
    keys: ["oquvchi qidirish", "oquvchini topish", "oquvchini topa olmayapman", "topilmadi", "ism boyicha", "guruh boyicha", "guruh raqami", "guruh boyicha tanlash", "telefon oxiri", "xato yozsam", "familiya", "yangi oquvchi", "oquvchi qoshish", "royxatda yoq"],
    who: "kassir",
    where: "Yangi avtomobil → «Avtoshkola o'quvchisi» → «O'quvchini toping»",
    page: "add",
    text: "Ismni xato yozsangiz ham dastur o'xshashini topadi. Guruh raqamini yozsangiz o'sha guruhlar chiqadi; telefon raqamining oxiri bilan ham topiladi.",
    steps: [
      "«O'quvchini toping» maydoniga ism yoki familiyani yozing.",
      "Yoki guruh raqamini yozing (masalan 12) — guruhlar chiqadi.",
      "Yoki «Guruh bo'yicha tanlash» ni bosib avtoshkola → guruh → o'quvchini bosing.",
      "Yoki «1. Avtoshkola» → «2. Guruh» → «3. O'quvchi» tugmalari bilan tanlang.",
      "Umuman topilmasa — Enter bosing: «Yangi o'quvchi» oynasida F.I.Sh. va avtoshkolani yozib «Saqlash» ni bosing."
    ],
    tips: [
      "«QR chek» sahifasida ham qidiruv xuddi shunday ishlaydi.",
      "↓ ↑ strelkalar bilan boshqa ismni tanlaysiz."
    ],
    related: ["davomat", "qr-chek", "guruh-import"]
  },
  {
    id: "qr-chek",
    title: "QR chek (avtoshkola o'quvchisi uchun)",
    keys: ["qr chek", "qr", "qr kod", "qrchek", "kyuar", "instruktor skanerlaydi", "skaner", "skanerlash", "bugungi cheklar", "chekni bekor qilish", "bekor chek", "kutilmoqda", "ishlatilgan", "dars davomiyligi", "chek beriladigan avtoshkola"],
    who: "kassir",
    where: "Chap menyu → QR chek",
    page: "kassa",
    text: "Belgilangan avtoshkola o'quvchisiga QR kodli chek beriladi va davomat shu zahoti yoziladi. O'quvchi chekni instruktorga beradi, instruktor uni o'z panelida skanerlaydi — dars boshlanadi.",
    steps: [
      "Chap menyudan «QR chek» ni oching.",
      "«Chek beriladigan avtoshkola» ni bir marta tanlang (saqlanib qoladi).",
      "O'quvchini ism yoki guruh raqami bo'yicha qidirib tanlang.",
      "«Dars davomiyligi» dan «30 daq», «1 soat», «1.5 soat» yoki «2 soat» ni tanlang.",
      "«QR chek chiqarish» ni (yoki Enter) bosing, so'ng «Chop etish»."
    ],
    tips: [
      "«Bugungi cheklar» da holat: kutilmoqda, ishlatilgan, bekor.",
      "Xato chek — «Bekor» tugmasi bilan bekor qilinadi; u bilan yozilgan davomat ham bekor bo'ladi.",
      "Avtoshkola darslari tekin — summa yo'q.",
      "Kirish muddati tugagan bo'lsa tugma «Kirish muddati tugagan — chek chiqmaydi» bo'ladi."
    ],
    related: ["davomat", "bepul-limit", "katta-ekran", "kirish-muddati", "shaxsiy-qr"]
  },
  {
    id: "shaxsiy-qr",
    title: "Shaxsiy QR va USB skaner (ism yozmasdan chek)",
    keys: ["shaxsiy qr", "qr skaner", "usb skaner", "skaner yoqish", "skanerni yoqish", "skaner qayerdan", "skaner sotib olish", "qanday skaner", "2d skaner", "qr ni yoqotdi", "qr yoqoldi", "qr qayta chiqarish", "skaner ishlamayapti", "skanerni sinash", "ism yozmasdan", "tez chek", "qr urilsa"],
    who: "rahbar (yoqish), kassir (ishlatish)",
    where: "Maxsus bo'lim → Boshqaruv → QR skaner",
    page: "scanner",
    text: "Yoqilgach o'quvchining birinchi chekida uning shaxsiy QR kodi chiqadi. Keyingi safar o'quvchi o'sha QR ni (qog'ozda yoki telefonida) skanerga ko'rsatadi — ism yozilmaydi, oddiy chek o'zi chiqadi. Boshida o'chiq: cheklar QR'siz chiqadi.",
    steps: [
      "Kassaga 2D USB skaner ulang (QR o'qiydigan, telefon ekranidan ham o'qisin).",
      "Maxsus bo'lim → Boshqaruv → «QR skaner» ni oching va «Skanerni sinash» da istalgan kodni uring — «Skaner ishlayapti» chiqsin.",
      "«Yoqish» ni bosing.",
      "Har o'quvchining birinchi chekida «SHAXSIY QR — SIZNIKI» chiqadi; o'quvchiga saqlab qo'yishni yoki telefoniga rasmga olishni ayting.",
      "Keyingi safar QR ni skanerga urish kifoya: «QR chek» sahifasida — QR chek chiqib, chop etiladi; boshqa sahifada — avtoshkola davomati + chek."
    ],
    tips: [
      "QR ni yo'qotgan bo'lsa — o'quvchini tanlang, o'quvchi kartasida «QR ni qayta chiqarish» ni bosing (o'sha QR qayta chiqadi).",
      "5 daqiqa ichida o'sha o'quvchi qayta urilsa — chek chiqishidan oldin so'raladi.",
      "Oddiy «1D / lazer» skaner QR ni o'qimaydi — «2D» bo'lishi kerak. O'rnatish kerak emas, klaviatura bo'lib ishlaydi.",
      "Kirish muddati tugagan yoki bepul limit tugagan bo'lsa — skanerda ham chek odatdagidek chiqmaydi.",
      "«QR chek» sahifasida faqat tanlangan avtoshkola o'quvchisiga chek chiqadi."
    ],
    related: ["qr-chek", "davomat", "kirish-muddati"]
  },
  {
    id: "bepul-limit",
    title: "Bepul limit (shartnoma bo'yicha kirishlar)",
    keys: ["bepul limit", "limit", "limit tugadi", "limit tugagan", "shartnoma", "shartnoma limiti", "bepul kirish", "necha marta bepul", "chek chiqarilmadi", "nechinchi kelishi", "kelishi", "pullik boldi", "limitdan oshdi"],
    who: "hamma",
    where: "O'quvchi tanlanganda — o'quvchi kartasida",
    page: "kassa",
    text: "Har avtoshkolaning shartnomasida bepul kirishlar soni bor. O'quvchi tanlanganda nechinchi kelishi va qancha qolgani ko'rinadi.",
    steps: [],
    tips: [
      "Limit tugagan bo'lsa chek chiqmaydi («CHEK CHIQARILMADI — bepul limit tugagan»), lekin davomat baribir yoziladi.",
      "2 ta yoki kamroq bepul kirish qolsa ogohlantirish chiqadi.",
      "Limitdan oshganlar «Xatoliklar va aniqliklar» → «Shartnoma limitidan oshgan kirishlar» da ko'rinadi.",
      "Limitni rahbar «Admin panel» → «Avtoshkolalar» → «Bepul kirishlar (shartnoma)» da qo'yadi."
    ],
    related: ["davomat", "qr-chek", "nazorat", "admin-panel"]
  },
  {
    id: "kirish-muddati",
    title: "Avtodromga kirish muddati va shaxsiy muhlat",
    keys: ["kirish muddati", "muddat", "muddati tugagan", "muddati otgan", "muhlat", "muhlat berish", "shaxsiy muhlat", "guruh muddati", "kira olmaydi", "kasal bolgan", "sababli kelolmagan", "uzaytirish", "muddat uzaytirish"],
    who: "hamma",
    where: "O'quvchi kartasi → «Muhlat berish»; rahbar: Admin panel → «Kirish muddatlari»",
    page: "add",
    text: "Guruhga avtodromga qachondan-qachongacha kirishi mumkinligi belgilanadi. Muddat tugasa davomat va QR chek yozilmaydi.",
    steps: [
      "O'quvchini tanlang — kartada «Avtodromga kirish: … gacha» ko'rinadi.",
      "Muddat tugagan va o'quvchi sababli kelolmagan bo'lsa — «Muhlat berish» ni bosing.",
      "Sanani tanlang (yoki «+3 kun», «+7 kun», «+14 kun», «+30 kun»).",
      "«Sababi» ni yozing va «Muhlat berish» ni bosing."
    ],
    tips: [
      "Muhlat faqat shu o'quvchiga beriladi, guruhdoshlariga ta'sir qilmaydi.",
      "Sababsiz saqlanmaydi — yozuv o'zgarishlar jurnaliga tushadi.",
      "Guruh muddatini rahbar «Admin panel» → «Kirish muddatlari» da qo'yadi."
    ],
    related: ["davomat", "qr-chek", "admin-panel"]
  },
  {
    id: "katta-ekran",
    title: "Katta ekran (darslar televizorda)",
    keys: ["katta ekran", "ekran", "televizor", "monitor", "ikkinchi monitor", "teskari sanoq", "darslar ekrani", "tv", "ekranga chiqarish", "ekran ochish", "darslar televizorda"],
    who: "hamma",
    where: "QR chek → «Katta ekran»",
    page: "kassa",
    text: "Hozir ketayotgan avtoshkola darslari teskari sanoq bilan katta ekranda ko'rinadi. Instruktor QR chekni skanerlashi bilan dars ekranga chiqadi; vaqti tugasa kartochka qizil bo'ladi.",
    steps: [
      "«QR chek» sahifasini oching.",
      "Yuqoridagi «Katta ekran» tugmasini bosing — yangi oynada ochiladi.",
      "Oynani ikkinchi monitor yoki televizorga o'tkazing va butun ekran qiling (F11)."
    ],
    tips: [
      "Shu brauzerda dasturga kirilgan bo'lishi kerak."
    ],
    related: ["qr-chek", "davomat"]
  },

  /* ===================== POST VA INTERNET ===================== */
  {
    id: "post",
    title: "1-POST va 2-POST (qaysi kassa)",
    keys: ["post", "1-post", "2-post", "1 post", "2 post", "birinchi kassa", "ikkinchi kassa", "kassa tanlash", "qaysi kassa", "post tanlash", "post ozgartirish", "postni almashtirish", "post qulflangan", "yashil tugma tepada"],
    who: "hamma",
    where: "Tepada o'ngdagi yashil «1-POST» tugmasi",
    page: null,
    text: "Ikki kassa bitta hisob ichida ishlaydi. Har kompyuter o'z postini bir marta tanlaydi; shu kompyuterda ochilgan vaqt, olingan pul va xarajat o'sha postga yoziladi.",
    steps: [
      "Tepadagi yashil «1-POST» (yoki «2-POST») tugmasini bosing.",
      "«Bu kompyuter qaysi kassa?» oynasida «1-POST» yoki «2-POST» ni tanlang."
    ],
    tips: [
      "Asosiy hisobga qo'shilgan kassir logini o'z postiga biriktirilgan — uning belgisi qulflangan, qaysi kompyuterda kirmasin pul o'sha postga yoziladi.",
      "Qulflangan postni rahbar o'zgartiradi: Maxsus bo'lim → Boshqaruv → «Hisoblar» → «Posti».",
      "Kunlik hisobotdagi «Kassalar bo'yicha» jadvali 1-POST va 2-POST ni alohida ko'rsatadi."
    ],
    related: ["hisobotga-qoshish", "hisobot", "hisoblar"]
  },
  {
    id: "internetsiz",
    title: "Internet o'chsa (internetsiz rejim)",
    keys: ["internet", "internet yoq", "internet yo'q", "internet ochdi", "internet o'chdi", "internetsiz", "offline", "oflayn", "aloqa yoq", "wifi", "vay fay", "kutmoqda", "qizil belgi", "internet qaytdi", "net yoq", "svet ochdi"],
    who: "hamma",
    where: "Tepadagi qizil «Internet yo'q · N ta kutmoqda» belgisi",
    page: null,
    text: "Internet o'chsa ham kassa ishlayveradi: «Kirdi», «Chiqdi», «To'lash» va davomat shu kompyuterda saqlanadi. Internet qaytishi bilan hammasi haqiqiy vaqti bilan o'zi serverga yuboriladi.",
    steps: [
      "Odatdagidek ishlayvering — tepada qizil «Internet yo'q · N ta kutmoqda» belgisi turadi.",
      "Belgini bossangiz, yuborilishini kutayotgan yozuvlar ro'yxati ochiladi.",
      "Internet qaytgach belgi o'zi yo'qoladi; kerak bo'lsa «Hozir yuborish» ni bosing."
    ],
    tips: [
      "Navbat va bron, «Bir qismini yopish», hisobot, Excel va Maxsus bo'lim faqat internet bilan ishlaydi.",
      "Sahifani yopsangiz yoki yangilasangiz ham internetsiz yozilganlar yo'qolmaydi.",
      "Internetsiz ochilgan mashina yonida bulut belgisi turadi.",
      "Hisobot internet qaytgach yangilanadi."
    ],
    related: ["muammo-otmadi", "muammo-qotdi", "kirdi", "qarz-tolash"]
  },

  /* ===================== MAXSUS BO'LIM ===================== */
  {
    id: "maxsus",
    title: "Maxsus bo'lim nima va qanday ochiladi",
    keys: ["maxsus", "maxsus bolim", "maxsus bo'lim", "maxsus parol", "parol bilan", "qulf", "qulflangan", "qulflandi", "hisobot qayerda", "hisobot korinmayapti", "menyu yoq", "rahbar bolimi", "boshqaruv", "qulflash", "15 daqiqa"],
    who: "hamma",
    where: "Chap menyu → «Maxsus bo'lim» (qulf belgisi)",
    page: null,
    text: "Kunlik hisobot, Rasxod, Excel, Tarix, Xatoliklar va aniqliklar, Instruktorlar, Telegram bot, Hisoblar va Admin panel faqat Maxsus parol bilan ochiladi. Kassa bo'limlari parolsiz ishlaydi. Parol rahbarda.",
    steps: [
      "Chap menyudagi «Maxsus bo'lim» ni bosing.",
      "Parolni yozing va «Ochish» ni bosing (parolni rahbar biladi).",
      "Menyuda Hisobot, Nazorat va Boshqaruv bo'limlari ochiladi.",
      "Ish tugagach menyu pastidagi «Qulflash» ni bosing."
    ],
    tips: [
      "15 daqiqa ishlatilmasa bo'lim o'zi qulflanadi; brauzer yopilsa ham qulflanadi.",
      "Sahifa yangilansa (F5) shu oynada ochiq qoladi.",
      "Excel'da saqlanmagan o'zgarish bo'lsa, ish yo'qolmasligi uchun qulflanmaydi."
    ],
    related: ["maxsus-parol", "hisobot", "kim-nima", "kirish-kodi-ozgartirish"]
  },
  {
    id: "maxsus-parol",
    title: "Maxsus parolni unutsa yoki o'zgartirish",
    keys: ["maxsus parolni unutdim", "parolni unutdim", "parolni tiklash", "parol tiklash", "parolni ozgartirish", "parolni o'zgartirish", "yangi parol", "parol almashtirish", "maxsus parol esdan chiqdi", "parolni yangilash"],
    who: "rahbar",
    where: "Maxsus bo'lim → «Parolni unutdim» / «Parolni o'zgartirish»",
    page: null,
    text: "Maxsus parolni rahbar boshqaradi. Unutilsa — tizimga kirish (hisob) paroli bilan yangisi qo'yiladi.",
    steps: [
      "Unutilgan bo'lsa: «Maxsus bo'lim» ni bosing → «Parolni unutdim».",
      "Yangi parolni ikki marta yozing (kamida 4 belgi).",
      "Tasdiqlash uchun tizimga kirish (hisob) parolini yozing va «Saqlash va ochish» ni bosing.",
      "O'zgartirish uchun: Maxsus bo'lim ochiq turganda pastdagi «Parolni o'zgartirish» → «Hozirgi parol» va yangi parol → «Saqlash»."
    ],
    tips: [
      "Parol hamma kompyuterda bir xil — bir joyda o'zgarsa, hammasida o'zgaradi.",
      "Kassir parolni bilmasa — rahbarga murojaat qilsin; yordamchi parolni aytmaydi."
    ],
    related: ["maxsus", "kod-unutildi"]
  },
  {
    id: "kirish-kodi-ozgartirish",
    title: "Saytga kirish kodini o'zgartirish",
    keys: ["kirish kodini ozgartirish", "kirish kodini o'zgartirish", "kodni ozgartirish", "yangi kod", "kod almashtirish", "saytga kirish kodi", "pin ozgartirish", "kodni yangilash", "kod qoyish", "kirish kodini almashtirish", "yangi kirish kodi"],
    who: "rahbar",
    where: "Maxsus bo'lim → menyu pastida «Saytga kirish kodi»",
    page: null,
    text: "Sayt ochilganda so'raladigan kod hamma kompyuterda bir xil. Uni rahbar Maxsus bo'limdan o'zgartiradi.",
    steps: [
      "Maxsus bo'limni oching.",
      "Menyuning pastidagi «Saytga kirish kodi» ni bosing.",
      "«Yangi kod» va «Yana bir marta» ga 4–8 ta raqam yozing.",
      "«Saqlash» ni bosing."
    ],
    tips: [
      "Boshqa kompyuterlarda keyingi kirishda yangi kod so'raladi — kassirlarga yangi kodni o'zingiz ayting.",
      "Kodni hech qayerga yozib qoldirmang; yordamchi kodni aytmaydi."
    ],
    related: ["tizimga-kirish", "kod-unutildi", "maxsus"]
  },

  /* ===================== HISOBOT ===================== */
  {
    id: "hisobot",
    title: "Kunlik hisobotni qanday o'qish",
    keys: ["hisobot", "kunlik hisobot", "otchet", "hisobotni oqish", "kartalar", "umumiy summa", "kassada naqd qoldi", "jami kirim", "kassalar boyicha", "post boyicha", "platniy", "jami vaqt", "hisobot qanday", "kun yakuni", "kassa yopish", "kassa topshirish"],
    who: "rahbar",
    where: "Maxsus bo'lim → Hisobot → Kunlik hisobot",
    page: "daily",
    text: "Tanlangan kun yoki davrning to'liq hisoboti: kartalar, kassalar bo'yicha jadval va har bir yozuv. Pul hamma joyda bitta qoida bilan sanaladi.",
    steps: [
      "Maxsus bo'limni oching va «Kunlik hisobot» ni bosing.",
      "Kartalar: «Avtomobillar», «Umumiy summa», «Naqd», «Terminal», «Klik», «Rasxod», «Kechagi (qarzdan)», «Kassada naqd qoldi», «To'lanmagan», «Jami vaqt».",
      "«Kassalar bo'yicha» jadvalida har post alohida: Naqd, Terminal, Klik, Kechagi, «JAMI KIRIM», To'lanmagan, Xarajat, «Kassada naqd qoldi».",
      "Pastda «Hammasi», «Platniy», «Avtoshkola» bilan ro'yxatni ajrating va qidiruvdan foydalaning."
    ],
    tips: [
      "«Kassada naqd qoldi» = naqd tushum + kechagi qarzdan naqd − naqd xarajat.",
      "«To'lanmagan» kartasi kassadagi «To'lanmagan» ro'yxatini, «Rasxod» kartasi Rasxod sahifasini ochadi.",
      "Ichkaridagi mashina ham hisobotga darhol tushadi («Ichkarida» belgisi bilan).",
      "Hisobot raqamlarini yordamchi aytmaydi — ularni shu sahifada ko'rasiz."
    ],
    related: ["hisobot-davr", "kechagi", "kunlik-excel", "rasxod", "post"]
  },
  {
    id: "kechagi",
    title: "«Kechagi (qarzdan)» nima va qarz to'lovi qaysi kunga tushadi",
    keys: ["kechagi", "kechagi qarzdan", "kechagi qarz", "eski qarz", "oldingi kun qarzi", "qarz qaysi kunga", "qarz qaysi kunga tushadi", "yagona qoida", "ikki marta sanalmaydi", "kecha qarz bugun toladi", "qarz tolovi hisobotda"],
    who: "hamma",
    where: "Kunlik hisobot → «Kechagi (qarzdan)» kartasi va «Kassalar bo'yicha»",
    page: "daily",
    text: "Pul to'langan kunga yoziladi. Bugungi qarz bugun to'lansa — Naqd/Terminal/Klik ichida; oldingi kunlardagi qarz bugun to'lansa — bugungi «Kechagi (qarzdan)» da. Bitta pul ikki marta sanalmaydi.",
    steps: [],
    tips: [
      "Qarz to'lovi qaysi postda olingan bo'lsa, o'sha postga yoziladi.",
      "«Kassalar bo'yicha» ostida «Kechagi qarzlardan to'langanlar» ro'yxati bor: qaysi kungi qarz, qachon va qaysi postda to'langan.",
      "Qatordagi «qarz … — … to'landi» yozuvi qarz keyinroq to'langanini bildiradi.",
      "Pul faqat to'langan kunga tushadi: o'tgan kunning hisobotida pul ham, «To'lanmagan» ham o'sha kun oxiridagidek qoladi."
    ],
    related: ["hisobot", "qarz-tolash", "qarz-bekor"]
  },
  {
    id: "hisobot-davr",
    title: "Hisobotni boshqa kun yoki davr bo'yicha ko'rish",
    keys: ["davr", "sana tanlash", "kecha", "kechagi hisobot", "shu oy", "otgan oy", "oxirgi 7 kun", "hafta", "sanadan", "sanagacha", "oylik hisobot", "haftalik hisobot", "boshqa kun", "bir necha kun"],
    who: "rahbar",
    where: "Kunlik hisobot → «Sanadan» / «Sanagacha»",
    page: "daily",
    text: "Bitta kun yoki davr (masalan, oyning 1-dan 10-gacha) tanlanadi. Davr tanlansa, pastda har kun alohida ham ko'rinadi.",
    steps: [
      "«Kunlik hisobot» ni oching.",
      "Tez tugmalardan birini bosing: «Bugun», «Kecha», «Oxirgi 7 kun», «Shu oy», «O'tgan oy».",
      "Yoki «Sanadan» va «Sanagacha» ni o'zingiz tanlang.",
      "«Ko'rsatish» ni bosing."
    ],
    tips: [
      "Ko'pi bilan 92 kun tanlash mumkin.",
      "«Tanlangan davr» yozuvida qaysi kunlar ko'rsatilayotgani turadi."
    ],
    related: ["hisobot", "kunlik-excel"]
  },
  {
    id: "togrilash",
    title: "Xato yozuvni to'g'rilash (to'lov noto'g'ri yozilgan)",
    keys: ["togrilash", "to'g'rilash", "tugrilash", "xato", "xato yozdim", "xato bosdim", "notogri", "notogri tolov", "naqd orniga terminal", "terminal orniga naqd", "klik orniga", "xato yozuv", "tuzatish", "ispravit", "summani togrilash", "pul olinmagan", "tolangan deb yozilgan"],
    who: "rahbar",
    where: "Maxsus bo'lim → Kunlik hisobot (yoki Tarix) → qatordagi «To'g'rilash»",
    page: "daily",
    text: "Pul noto'g'ri yozilgan bo'lsa (naqd o'rniga terminal, to'lanmagan «to'langan» bo'lib qolgan va h.k.) qatordagi «To'g'rilash» bilan tuzatiladi. Hisobot va Excel o'zi yangilanadi.",
    steps: [
      "Maxsus bo'limni oching → «Kunlik hisobot» (yoki «Tarix»).",
      "Kerakli mashina qatorida «To'g'rilash» ni bosing.",
      "Tez tugmalardan birini bosing: «To'lanmagan», «Naqd to'langan», «Terminal», «Klik» — yoki «Naqd», «Terminal», «Klik», «To'lanmagan» maydonlariga summani yozing.",
      "«Sababi» ni yozing (kamida 5 harf) va «Saqlash» ni bosing."
    ],
    tips: [
      "Qarzni hozir to'layotgan bo'lsa — bu oyna emas, kassadagi «To'lanmagan» → «To'lash» ishlatiladi.",
      "To'g'rilangan qatorda «to'g'rilangan» belgisi turadi, har o'zgarish jurnalga yoziladi.",
      "Kassir xato qilsa — rahbarga aytadi, rahbar Maxsus bo'limdan to'g'rilaydi.",
      "O'tgan kundagi yozuvga pul qo'shilsa — u o'tgan kunga yozilmaydi: bugungi tushumga («Kechagi») tushadi, o'tgan kun hisoboti o'zgarmaydi."
    ],
    related: ["qarz-bekor", "hisobot", "excel-bolimi", "tarix"]
  },
  {
    id: "rasxod",
    title: "Rasxod (xarajat) yozish",
    keys: ["rasxod", "rashod", "xarajat", "harajat", "benzin", "gaz", "remont", "avans", "oylik", "oshxona", "xarajat yozish", "xarajat qoshish", "kassadan pul oldi", "xarajatni ochirish", "xarajatni tahrirlash", "spidometr", "litr"],
    who: "rahbar",
    where: "Maxsus bo'lim → Hisobot → Rasxod",
    page: "rasxod",
    text: "Kunlik xarajatlar shu yerda yoziladi. Ular kunlik hisobotga («Kassada naqd qoldi») va kunlik Excelga o'zi tushadi.",
    steps: [
      "Maxsus bo'limni oching va «Rasxod» ni bosing.",
      "Tayyor turlardan birini bosing (Benzin, Gaz, Remont, Avans, Oylik, Oshxona ...) yoki «Xarajat turi» ga yozing.",
      "«Summa (so'm)» ni yozing; kerak bo'lsa «Kim / kimga», «Mashina raqami», «Izoh».",
      "«To'lov turi» dan «Naqd», «Karta» yoki «Klik» ni tanlang.",
      "«Saqlash» ni bosing."
    ],
    tips: [
      "Benzin yoki gazda litr (m³) va spidometr (km) maydonlari ham chiqadi.",
      "Tuzatish — ro'yxatdagi qalam belgisi, o'chirish — savatcha belgisi.",
      "Boshqa kun xarajatini ko'rish: «Kun» maydoni, «Bugun», «Kecha».",
      "Xarajat qaysi postda yozilsa, o'sha postning hisobidan ayriladi."
    ],
    related: ["hisobot", "kunlik-excel", "excel-bolimi"]
  },
  {
    id: "kunlik-excel",
    title: "Kunlik Excel faylini yuklab olish",
    keys: ["excel", "eksel", "kunlik excel", "excel yuklab olish", "excel fayl", "xlsx", "jadval excel", "yuklab olish", "skachat", "hisobotni excelga", "export", "eksport", "hisobot varagi"],
    who: "rahbar",
    where: "Kunlik hisobot (yoki Rasxod) → «Kunlik Excel»",
    page: "daily",
    text: "Kunlik Excel — tayyor shakldagi fayl: JISMONIY, KURS, XARAJATLAR, BENZIN, KLIK, HISOBOT varaqlari bazadan o'zi to'ldiriladi.",
    steps: [
      "Maxsus bo'lim → «Kunlik hisobot» ni oching.",
      "Kun yoki davrni tanlab «Ko'rsatish» ni bosing.",
      "Yashil «Kunlik Excel» tugmasini bosing — fayl kompyuterga yuklanadi.",
      "Oddiy jadval kerak bo'lsa — «Jadval (Excel)»."
    ],
    tips: [
      "«Rasxod» sahifasidagi «Kunlik Excel» tanlangan kun uchun chiqaradi.",
      "Fayl tayyorlash uchun internet kerak.",
      "Jadvalni dasturning o'zida tahrirlash uchun «Excel» bo'limi bor."
    ],
    related: ["hisobot", "excel-bolimi", "rasxod"]
  },
  {
    id: "excel-bolimi",
    title: "«Excel» bo'limi: jadvalni tahrirlash va saqlash",
    keys: ["excel bolimi", "excel bo'limi", "excelda tahrirlash", "jadvalni tahrirlash", "katak", "saqlash", "ctrl+s", "ctrl s", "yangi qator", "qatorni ochirish", "jismoniy", "xarajatlar varagi", "kurs varagi", "yozuv tarixi", "sariq katak", "qizil katak", "excelda ozgartirish"],
    who: "rahbar",
    where: "Maxsus bo'lim → Hisobot → Excel",
    page: "sheet",
    text: "Kunning hamma yozuvlari Excel ko'rinishidagi jadvalda ochiladi. Kataklarga to'g'ridan-to'g'ri yozib, «Saqlash» (Ctrl+S) bilan bazaga saqlanadi.",
    steps: [
      "Maxsus bo'lim → «Excel» ni oching; kerakli sanani tanlang.",
      "Pastdan varaqni tanlang: «JISMONIY», «XARAJATLAR» yoki «KURS» (KURS faqat ko'rish uchun).",
      "Katakni tanlab yozing va Enter bosing. Yangi mashina yoki xarajat — pastdagi bo'sh qatorga («Yangi qator», Ctrl+Enter).",
      "Hammasini «Saqlash» (Ctrl+S) bilan bazaga saqlang.",
      "Chiqish — «Yopish» (Esc)."
    ],
    tips: [
      "O'zgargan katak sariq, xato katak qizil bo'ladi; xato bo'lsa hech narsa saqlanmaydi.",
      "«Qatorni o'chirish» (Ctrl+Delete) — saqlangungacha qayta bosilsa qaytadi.",
      "«Yozuv tarixi» (Ctrl+H) — chek qachon chiqqan, qachon kirgan-chiqqan, kim o'zgartirgan.",
      "Saqlanmagan o'zgarish bo'lsa yopishda so'raladi."
    ],
    related: ["kunlik-excel", "togrilash", "rasxod"]
  },
  {
    id: "tarix",
    title: "Tarix: mashina yoki o'quvchi bo'yicha qidirish",
    keys: ["tarix", "tarixi", "mashina tarixi", "qachon kelgan", "oldin kelganmi", "tashriflar", "oquvchi tarixi", "eski yozuv", "raqam boyicha qidirish", "istoriya", "qidirish"],
    who: "rahbar",
    where: "Maxsus bo'lim → Hisobot → Tarix",
    page: "history",
    text: "Mashina raqami bo'yicha hamma tashriflari; o'quvchi yoki avtoshkola nomi bo'yicha — kunlik hisobotda tanlangan davrdan.",
    steps: [
      "Maxsus bo'lim → «Tarix» ni oching.",
      "Mashina raqamini yoki o'quvchi ismini yozing.",
      "«Qidirish» ni bosing."
    ],
    tips: [
      "Ism bo'yicha topilmasa — «Kunlik hisobot» da boshqa davrni tanlab, qayta qidiring.",
      "Natijadagi qatorlarda ham «To'g'rilash» tugmasi bor."
    ],
    related: ["hisobot", "togrilash", "telegram"]
  },

  /* ===================== NAZORAT VA BOSHQARUV ===================== */
  {
    id: "nazorat",
    title: "Xatoliklar va aniqliklar (instruktorlar nazorati)",
    keys: ["xatoliklar", "aniqliklar", "xatoliklar va aniqliklar", "nazorat", "instruktor kam tolagan", "kam tolagan", "tolashi kerak", "platniy soat", "bepul soat", "instruktorsiz", "instruktorsiz yozuv", "farq", "kontrol", "limitdan oshgan kirishlar"],
    who: "rahbar",
    where: "Maxsus bo'lim → Nazorat → Xatoliklar va aniqliklar",
    page: "control",
    text: "Har instruktor bo'yicha: nechta o'quvchi uchirgan, nechtasi platniy, necha soat va qancha to'lagan. «To'lashi kerak» = platniy soat × soatlik narx.",
    steps: [
      "Maxsus bo'lim → «Xatoliklar va aniqliklar» ni oching.",
      "Sanani tanlang yoki «Bugun» / «Kecha» ni bosing, so'ng «Tekshirish».",
      "Holatga qarang: «To'g'ri», «Kam to'lagan», «Ortiqcha to'langan», «Aniqlik kerak», «Hammasi bepul».",
      "Kerak bo'lsa «Excel» bilan yuklab oling."
    ],
    tips: [
      "Farq qizil bo'lsa — instruktor kam to'lagan.",
      "«Instruktorsiz yozuv» — instruktor yozilmagan kirishlar; kirishda instruktorni yozib borish nazoratni aniq qiladi.",
      "Pastda «Shartnoma limitidan oshgan kirishlar» ro'yxati bor."
    ],
    related: ["instruktorlar", "instruktor-biriktirish", "bepul-limit"]
  },
  {
    id: "instruktorlar",
    title: "Instruktorlar bo'limi",
    keys: ["instruktorlar", "instruktor", "instruktor qoshish", "yangi instruktor", "instruktorni tahrirlash", "instruktorni ochirish", "ommaviy qoshish", "instruktor tarixi", "kimni uchirgan", "qaysi mashinada", "instruktor mashinasi", "instruktor royxati"],
    who: "rahbar",
    where: "Maxsus bo'lim → Boshqaruv → Instruktorlar",
    page: "instructors",
    text: "Instruktorlar ro'yxati: telefoni, biriktirilgan mashinasi va hozir nechta faol mashinasi bor. «Tarix» — kimni, qachon va qaysi mashinada uchirgani.",
    steps: [
      "Maxsus bo'lim → «Instruktorlar» ni oching.",
      "Yangi qo'shish: «Instruktor qo'shish» → F.I.Sh., Avtoshkola (majburiy), kerak bo'lsa telefon va mashina → «Saqlash».",
      "Ko'pini birdan: «Ommaviy qo'shish» — har qatorga bitta F.I.Sh. (vergul bilan telefon) → «Qo'shish».",
      "Kartadagi «Tarix» — davrni tanlab «Ko'rsatish»; «Tahrirlash» — ma'lumotni o'zgartirish."
    ],
    tips: [
      "Ishlamay qolgan instruktorni o'chirmasdan «Holati» → «Faol emas» qilish mumkin.",
      "Mashinalar alohida «Admin panel» → «Mashinalar» da yuritiladi."
    ],
    related: ["instruktor-biriktirish", "nazorat", "admin-panel"]
  },
  {
    id: "telegram",
    title: "Telegram bot: xabarlar va raqam bo'yicha so'rash",
    keys: ["telegram", "telegram bot", "telegramga xabar", "botni ulash", "xabar keladi", "xabarnoma", "telefonga xabar", "bot token", "botfather", "guruhga qoshish", "odam qoshish", "botga raqam yozish", "402", "bot buyruqlari", "sinov xabari", "botni uzish"],
    who: "rahbar",
    where: "Maxsus bo'lim → Boshqaruv → Telegram bot",
    page: "telegram",
    text: "Bot ulansa, Kirdi, Chiqdi, vaqti tugab yopilgan va qarz to'langan xabarlari telefonga keladi. Botga mashina raqamini yozsangiz (masalan 402), shu raqamli hamma mashinalar haqida ma'lumot beradi.",
    steps: [
      "Maxsus bo'lim → «Telegram bot» ni oching.",
      "Bot ulanmagan bo'lsa: Telegramda @BotFather orqali bot oching, bergan tokenni «Bot tokeni» ga qo'yib «Ulash» ni bosing.",
      "«Odam yoki guruh qo'shish» ni bosing va chiqqan kodni botga yuboring (guruhda: /start va kod).",
      "«Qaysi xabarlar kelsin» bo'limida keraklilarini «Yoqilgan» qiling.",
      "Tekshirish uchun «Sinov xabari» ni bosing."
    ],
    tips: [
      "Bot buyruqlari: /ichkarida — hozir ichkaridagilar, /bugun — bugungi tushum, /qarzlar — to'lanmaganlar; guruhda /raqam va raqam.",
      "Bot faqat ulangan odam va guruhlarga javob beradi.",
      "Ulash kodi 10 daqiqa amal qiladi.",
      "Kimgadir xabar kerak bo'lmasa — uning yonidagi tugmani «O'chirilgan» qiling."
    ],
    related: ["hisoblar", "maxsus", "tarix"]
  },
  {
    id: "hisoblar",
    title: "Hisoblar va kompyuterlar (kim hozir kirgan)",
    keys: ["hisoblar", "hisoblar royxati", "akkaunt", "kim kirgan", "kim hozir kirgan", "kompyuterlar", "qaysi kompyuter", "loginlar", "kassirlar", "mashinalari", "kassir ochgan mashinalar", "kim ochgan", "onlayn", "hozir kirgan"],
    who: "rahbar",
    where: "Maxsus bo'lim → Boshqaruv → Hisoblar",
    page: "accounts",
    text: "Qaysi hisob bilan, qaysi kompyuterdan hozir kirilgani ko'rinadi. «Hozir» — oxirgi 5 daqiqada ishlagan.",
    steps: [
      "Maxsus bo'lim → «Hisoblar» ni oching.",
      "Kartalar: «Hozir kirgan hisoblar», «Hozir ishlayotgan kompyuterlar», «Bugun yozuv qilgan hisoblar», «Jami hisoblar».",
      "Kassir ochgan mashinalar: hisob qatorida «Mashinalari» → kunni tanlang; kerak bo'lsa «Excel».",
      "Ro'yxatni yangilash — «Yangilash»."
    ],
    tips: [
      "Hisob qatoridagi boshqa tugmalar: «Hisobotga qo'shish», «Ajratish», «Posti», «O'chirish».",
      "Yashil fonli qator — hozir kirgan hisob."
    ],
    related: ["hisobotga-qoshish", "hisob-ochirish", "post"]
  },
  {
    id: "hisobotga-qoshish",
    title: "Ikkinchi kassir loginini asosiy hisobga qo'shish",
    keys: ["hisobotga qoshish", "hisobotga qo'shish", "asosiy hisob", "asosiy hisobga qoshish", "ikkinchi kassir", "ikki login", "login qoshish", "kassir qoshish", "birlashtirish", "ajratish", "loginni ajratish", "posti", "kassirning posti", "bitta hisobot"],
    who: "rahbar",
    where: "Maxsus bo'lim → Boshqaruv → Hisoblar → «Hisobotga qo'shish»",
    page: "accounts",
    text: "Boshqa hisob asosiy hisobga qo'shilsa, u o'z logini bilan kiradi, lekin asosiy hisobda ishlaydi: Jarayonda, navbat, qarzlar, hisobot va Excel — hammasi bitta.",
    steps: [
      "Maxsus bo'lim → «Hisoblar» ni oching.",
      "Kerakli hisob qatorida «Hisobotga qo'shish» ni bosing.",
      "«Qaysi postda ishlaydi?» dan «1-POST» yoki «2-POST» ni tanlang.",
      "Maxsus parolni yozib «Hisobotga qo'shish» ni bosing.",
      "Keyin postini o'zgartirish — qatordagi «Posti: 1-POST / 2-POST»; qaytarish — «Ajratish»."
    ],
    tips: [
      "Hozirgacha yozganlari ham asosiy hisobotga o'tadi; uning o'z Maxsus paroli o'chadi.",
      "O'zingizni, admin hisobini, yozuvlari sizdan ko'p hisobni yoki boshqa asosiy hisobga qo'shilganni qo'shib bo'lmaydi.",
      "«Ajratish» da yozganlari asosiy hisobotda qoladi, u keyingi kirishda alohida bo'sh hisobda ishlaydi.",
      "Internet bilan ishlaydi."
    ],
    related: ["hisoblar", "post", "yangi-kassir", "hisob-ochirish"]
  },
  {
    id: "hisob-ochirish",
    title: "Hisobni butunlay o'chirish",
    keys: ["hisobni ochirish", "hisobni o'chirish", "akkauntni ochirish", "loginni ochirish", "kassirni ochirish", "butunlay ochirish", "hisob ochirildi", "bu hisob ochirilgan", "eski hisob", "keraksiz hisob", "hisobni yoqotish"],
    who: "rahbar",
    where: "Maxsus bo'lim → Boshqaruv → Hisoblar → «O'chirish»",
    page: "accounts",
    text: "Hisob va uning hamma ma'lumoti bazadan butunlay o'chadi. **Qaytarib bo'lmaydi.**",
    steps: [
      "Maxsus bo'lim → «Hisoblar» ni oching.",
      "Hisob qatorida «O'chirish» ni bosing — nima o'chishi ko'rsatiladi.",
      "Tasdiqlash uchun hisob loginini qo'lda yozing va Maxsus parolni kiriting.",
      "«Butunlay o'chirish» ni bosing."
    ],
    tips: [
      "O'zingizni, admin hisobini va yozuvlari sizdan ko'p hisobni o'chirib bo'lmaydi.",
      "Hisobdagi pul yozuvlari Kunlik hisobot, Excel va Boshliq ilovasidan ham chiqib ketadi — oldin yaxshi o'ylang.",
      "O'chirilgan hisob bilan kirganlar «Bu hisob rahbar tomonidan o'chirilgan» xabarini ko'radi."
    ],
    related: ["hisoblar", "hisobotga-qoshish"]
  },
  {
    id: "tozalash",
    title: "Jarayondagilarni tozalash (eski, yopilmay qolganlar)",
    keys: ["tozalash", "jarayonni tozalash", "eski yozuvlar", "yopilmay qolgan", "osilib qolgan", "kechadan qolgan", "jarayonda qolib ketdi", "hammasini yopish", "ommaviy yopish", "tozalashni qaytarish", "qaytarish", "supurgi"],
    who: "rahbar",
    where: "Jarayonda → qizil «Tozalash» (Maxsus parol)",
    page: "active",
    text: "Eski, yopilmay qolgan yozuvlarni bir bosishda to'xtatib olib tashlash. 24 soat ichida «Qaytarish» mumkin.",
    steps: [
      "«Jarayonda» bo'limida qizil «Tozalash» ni bosing (Maxsus parol so'raladi).",
      "Ro'yxatni tekshiring: qaysi birida pul olingan, qaysi birida olinmagan.",
      "«Tavsiya» variantini qoldiring: pul olinmaganlari o'chiriladi, pul olinganlari yopiladi (pul hisobotda qoladi).",
      "Kerak bo'lsa kutish rejimidagilarni ham belgilang, «Sababi» ni yozing va «To'xtatib tozalash» ni bosing."
    ],
    tips: [
      "«Hammasini o'chirish» tanlansa olingan pul hisobotdan ham chiqadi — ehtiyot bo'ling.",
      "Xato tozalangan bo'lsa: yana «Tozalash» ni oching va «Oxirgi tozalash» qatoridagi «Qaytarish» ni bosing (24 soat ichida).",
      "Internet bilan ishlaydi."
    ],
    related: ["jarayonda", "muammo-jarayonda", "maxsus"]
  },
  {
    id: "admin-panel",
    title: "Admin panel (avtoshkola, guruh, o'quvchi, mashinalar)",
    keys: ["admin panel", "admin", "avtoshkolalar", "avtoshkola qoshish", "guruh qoshish", "oquvchilar", "oquvchi qoshish", "oquvchini ochirish", "kirish muddatlari", "mashinalar", "avtoshkola mashinalari", "dashboard", "operator paneliga qaytish"],
    who: "rahbar",
    where: "Maxsus bo'lim → Boshqaruv → «Admin panel»",
    page: null,
    text: "Avtoshkolalar, guruhlar, o'quvchilar, kirish muddatlari, instruktorlar, mashinalar va Excel import shu yerda boshqariladi.",
    steps: [
      "Maxsus bo'limni oching va «Admin panel» ni bosing.",
      "Chapdagi bo'limlardan birini tanlang: «Dashboard», «Avtoshkolalar», «O'quvchilar», «Kirish muddatlari», «Instruktorlar», «Mashinalar», «Excel».",
      "Ish tugagach «Operator paneliga qaytish» ni bosing."
    ],
    tips: [
      "Avtoshkolaning bepul kirishlar soni «Avtoshkolalar» da, guruh muddatlari «Kirish muddatlari» da qo'yiladi.",
      "Maxsus bo'lim qulflansa admin panel ham yopiladi."
    ],
    related: ["guruh-import", "guruh-tiklash", "kirish-muddati", "bepul-limit"]
  },
  {
    id: "guruh-import",
    title: "Guruhli ro'yxatni fayldan import qilish",
    keys: ["import", "royxat import", "guruh royxati", "guruhli royxat", "fayldan import", "word fayl", "excel fayl import", "oquvchilarni yuklash", "kop oquvchi qoshish", "matndan qoshish", "royxatni kiritish", "shablon", "importni bekor qilish", "ustiga qoshilib ketdi", "boshqa guruhga qoshilib ketdi", "oxirgi qoshilganlar", "royxatni qaytarish"],
    who: "rahbar",
    where: "Admin panel → Excel → «Guruhli ro'yxat»",
    page: null,
    text: "Word yoki Excel fayldagi bir nechta guruh o'quvchilari birdaniga qo'shiladi; bazada yo'q guruhlar o'zi ochiladi.",
    steps: [
      "Maxsus bo'lim → «Admin panel» → «Excel» ni oching.",
      "«Guruhli ro'yxat» kartasida «Fayldan import» ni bosib faylni tanlang (yoki «Matndan qo'shish» → nusxani qo'yib «Ko'rib chiqish»).",
      "Oynada «Qaysi avtoshkolaga yozilsin?» ni tanlang va guruhlar jadvalini tekshiring.",
      "«… ta o'quvchini import qilish» tugmasini bosing."
    ],
    tips: [
      "Guruh sarlavhasi «30-guruh» yoki «11-2026гр.» ko'rinishida bo'lsin; har qatorda raqam, F.I.Sh., tug'ilgan sana (ixtiyoriy).",
      "Import oldidan hamma qator tekshiriladi, takroriy ism bir marta olinadi.",
      "O'quvchisi bor guruhga ro'yxat USTIDAN qo'shilmaydi: oynada qizil «Bu guruhda N ta o'quvchi bor» chiqadi. Bu yangi guruh bo'lsa, o'sha qatorga boshqa nom yozing (masalan «30-2»).",
      "Xato qo'shilgan ro'yxatni bekor qilish: «Guruhli ro'yxat» → «Oxirgi qo'shilganlar» → kerakli qatorda «Bekor qilish». Qizil «Ustiga qo'shilgan» — boshqa guruh ustiga tushib qolgan ro'yxat. Eski o'quvchilarga va davomati yozilganlarga tegilmaydi.",
      "Bitta ro'yxat (o'quvchilar yoki instruktorlar) uchun — o'sha kartadagi «Import» va «Shablon»."
    ],
    related: ["admin-panel", "guruh-tiklash", "oquvchi-qidiruv"]
  },
  {
    id: "guruh-tiklash",
    title: "O'chirilgan guruhni tiklash",
    keys: ["guruh tiklash", "guruhni tiklash", "ochirilgan guruh", "o'chirilgan guruh", "guruh ochib ketdi", "guruhni qaytarish", "xato ochirdim guruh", "guruh yoqoldi", "guruhni qayta tiklash", "oquvchilar yoqoldi"],
    who: "rahbar",
    where: "Admin panel → Avtoshkolalar → avtoshkola → «O'chirilgan guruhlar»",
    page: null,
    text: "O'chirilgan guruh va uning o'quvchilari qaytariladi; davomatlar joyida saqlangan bo'ladi.",
    steps: [
      "Maxsus bo'lim → «Admin panel» → «Avtoshkolalar» ni oching va avtoshkolani tanlang.",
      "«O'chirilgan guruhlar» tugmasini bosing.",
      "Kerakli guruhda «Tiklash» ni bosing va tasdiqlang."
    ],
    tips: [
      "Shu nomli guruh yangidan ochilgan bo'lsa — eski guruhdagi o'quvchilar va darslar o'shanga qo'shiladi."
    ],
    related: ["admin-panel", "guruh-import"]
  },
  {
    id: "boshliq-ilovasi",
    title: "Boshliq ilovasi (rahbar telefoni uchun)",
    keys: ["boshliq ilovasi", "boshliq", "rahbar ilovasi", "iphone", "telefondan korish", "telefonda hisobot", "mobil ilova", "ilova", "uydan korish", "boshliq telefoni", "rahbar telefoni"],
    who: "rahbar",
    where: "Rahbar telefonidagi alohida ilova",
    page: null,
    text: "Boshliq ilovasi — rahbar telefonida (iPhone) hisobotni ko'rish uchun alohida ilova. U uch bo'limni ko'rsatadi: Avtoshkola, Platniy va Xarajatlar.",
    steps: [],
    tips: [
      "Ilova faqat ko'radi — undan hech narsa o'zgartirilmaydi.",
      "Ma'lumot shu dasturdan olinadi: bu yerda to'g'rilansa, ilovada ham o'zgaradi.",
      "O'rnatish va ulash bo'yicha Adminga murojaat qiling."
    ],
    related: ["hisobot", "telegram"]
  },
  {
    id: "yangi-kassir",
    title: "Yangi kassir uchun hisob ochish («Yangi operator»)",
    keys: ["yangi operator", "yangi kassir", "hisob ochish", "royxatdan otish", "ro'yxatdan o'tish", "registratsiya", "yangi login", "login ochish", "yangi xodim", "ishchi qoshish"],
    who: "hamma",
    where: "Kirish oynasi → «Yangi operator»",
    page: null,
    text: "Yangi kassir o'z hisobini kirish oynasida ochadi. Keyin rahbar uni asosiy hisobga qo'shadi — shunda hamma bitta hisobotda ishlaydi.",
    steps: [
      "Kirish oynasida (kirish kodidan keyin) «Yangi operator» ni bosing.",
      "«To'liq ism», «Login» va «Parol» (kamida 6 belgi) ni yozing.",
      "«Ro'yxatdan o'tish» ni bosing.",
      "Rahbar: Maxsus bo'lim → «Hisoblar» → shu hisobda «Hisobotga qo'shish» va postini tanlaydi."
    ],
    tips: [
      "Asosiy hisobga qo'shilmasa, yangi hisob alohida — bo'sh ro'yxat va alohida hisobot bilan ishlaydi.",
      "Parolingizni hech kimga aytmang."
    ],
    related: ["hisobotga-qoshish", "tizimga-kirish", "post"]
  },

  /* ===================== MUAMMOLAR ===================== */
  {
    id: "muammo-jarayonda",
    title: "«Bu avtomobil hozir jarayonda» xabari chiqsa",
    keys: ["bu avtomobil hozir jarayonda", "hozir jarayonda", "jarayonda deyapti", "jarayonda chiqyapti", "kirdi bosilmayapti", "kiritolmayapman", "kiritib bolmayapti", "boshqa hisobda jarayonda", "boshqa hisobda", "allaqachon ichkarida", "mashina kirmayapti", "avtomobil jarayonda"],
    who: "kassir",
    where: "Yangi avtomobil → «Kirdi» bosilganda",
    page: "active",
    text: "Bu shu mashina hali yopilmaganini bildiradi: u «Jarayonda» yoki «Muzlatilgan» ro'yxatida turibdi. Avval o'shani «Chiqdi» qilish kerak.",
    steps: [
      "«Jarayonda» va «Muzlatilgan» bo'limlaridan shu raqamni qidiring.",
      "Mashina haqiqatan chiqqan bo'lsa — «Chiqdi» (yoki «Tugatish») qiling, keyin qayta «Kirdi».",
      "Xabarda «boshqa hisobda jarayonda: «…»» deyilsa — o'sha hisobda «Chiqdi» qilinadi; bilmasangiz rahbarga ayting.",
      "Mashina rostdan ichkarida va yangi mijoz kutayotgan bo'lsa — «Kirdi» ni bosavering: yozuv kutish rejimiga tushadi va oldingisi chiqishi bilan boshlanadi."
    ],
    tips: [
      "Ro'yxat eskirgan bo'lishi mumkin — «Jarayonda» da «Yangilash» ni bosing yoki F5.",
      "Kechadan yopilmay qolgan ko'p yozuvlar bo'lsa — rahbar «Tozalash» bilan tozalaydi."
    ],
    related: ["band-mashina", "chiqdi", "muzlatish", "tozalash"]
  },
  {
    id: "muammo-sessiya",
    title: "«Sessiya tugagan. Qaytadan kiring.» chiqsa",
    keys: ["sessiya tugagan", "sessiya tugadi", "qaytadan kiring", "tizimdan chiqarib yubordi", "chiqib ketdi", "login sorayapti", "yana login", "ozi chiqib ketdi", "hisob ochirilgan", "qayta kirish", "avtomatik chiqdi"],
    who: "hamma",
    where: "Istalgan sahifa",
    page: null,
    text: "Kirish muddati tugagan yoki hisob o'zgargan — dastur sizni kirish oynasiga qaytaradi. Bu xavfli emas.",
    steps: [
      "So'ralsa, kirish kodini tering.",
      "Login va parolingizni yozib «Kirish» ni bosing.",
      "Ishni davom ettiring — ochiq mashinalar joyida turadi."
    ],
    tips: [
      "Internetsiz yozilgan amallar o'chmaydi, qayta kirgandan keyin yuboriladi.",
      "«Bu hisob rahbar tomonidan o'chirilgan» chiqsa — rahbardan yangi login so'rang.",
      "Hisobingiz asosiy hisobga qo'shilganda ham bir marta qayta kirish so'raladi."
    ],
    related: ["tizimga-kirish", "kod-unutildi", "internetsiz"]
  },
  {
    id: "muammo-qotdi",
    title: "Sahifa qotib qolsa yoki ma'lumot yangilanmasa",
    keys: ["qotdi", "qotib qoldi", "osilib qoldi", "ishlamayapti", "sahifa ishlamayapti", "yangilanmayapti", "yangilash", "f5", "obnovit", "zavis", "sekin", "tugma bosilmayapti", "yuklanmayapti", "oq ekran", "xato chiqdi", "server bilan aloqa"],
    who: "hamma",
    where: "Istalgan sahifa",
    page: null,
    text: "Ko'p muammo sahifani yangilash bilan hal bo'ladi. Yangilaganda internetsiz yozilganlar va ochiq mashinalar yo'qolmaydi.",
    steps: [
      "Klaviaturada F5 ni bosing (yoki brauzerdagi yangilash tugmasi).",
      "Kirish kodi so'ralsa — tering.",
      "Ro'yxat eskirgan bo'lsa — sahifadagi «Yangilash» tugmasini bosing («Jarayonda», «Muzlatilgan», «Hisoblar»).",
      "«Server bilan aloqa vaqtincha ishlamayapti» chiqsa — biroz kutib qayta urinib ko'ring va tepadagi internet belgisiga qarang."
    ],
    tips: [
      "Excel'da saqlanmagan o'zgarish bo'lsa, F5 dan oldin «Saqlash» (Ctrl+S) ni bosing.",
      "Muammo takrorlansa — nima bosganingiz va chiqqan xabarni yozib, Adminga qo'ng'iroq qiling."
    ],
    related: ["internetsiz", "muammo-sessiya", "muammo-otmadi"]
  },
  {
    id: "muammo-chek",
    title: "Chek chiqmasa",
    keys: ["chek chiqmadi", "chek chiqmayapti", "printer ishlamayapti", "printer", "pechat bolmayapti", "chop etilmadi", "qogoz", "chek qogozi", "chek yoq", "talon chiqmadi", "oyna ochilmadi", "pop-up", "yangi oyna", "chek chiqmadi xabari"],
    who: "kassir",
    where: "«Kirdi» / «Davomat yozish + chek» / «Kirish taloni»",
    page: "active",
    text: "Avval printerni tekshiring: yoqilganmi, qog'oz bormi, kabel ulanganmi. Yozuv chek chiqmasa ham saqlangan bo'ladi — faqat chekni qayta chiqarasiz.",
    steps: [
      "Printerni tekshiring (yoqilgan, qog'oz bor, USB ulangan).",
      "Oddiy mijoz cheki: «Jarayonda» → mashina kartasidagi «Kirish taloni» → «Chop etish — 80 mm».",
      "Brauzer yangi oynani to'xtatsa — manzil satridagi belgidan bu saytga yangi oynalarga ruxsat bering.",
      "Avtoshkola o'quvchisida printer ishlamasa — «Davomat yozish (cheksiz)» bilan davomatni yozib qo'ying."
    ],
    tips: [
      "Chop etishda: masshtab 100%, sarlavha va pastki yozuvlar o'chirilgan bo'lsin.",
      "Bepul limit tugagan o'quvchiga chek ataylab chiqmaydi — bu xato emas.",
      "QR chekni qayta chop etish — chek oynasidagi «Chop etish»."
    ],
    related: ["chek", "davomat", "bepul-limit", "qr-chek"]
  },
  {
    id: "muammo-otmadi",
    title: "«N ta o'tmadi» yoki «N ta yuborilmagan» belgisi",
    keys: ["otmadi", "o'tmadi", "ta otmadi", "yuborilmagan", "server qabul qilmadi", "qayta yuborish", "yuborilmoqda", "yuborilmadi", "ta yuborilmagan", "internetsiz yozuv otmadi"],
    who: "hamma",
    where: "Tepadagi internet belgisi → oyna",
    page: null,
    text: "«Yuborilmoqda» yoki «N ta yuborilmagan» — yozuvlar navbatda, o'zi yuboriladi. «N ta o'tmadi» — server bu yozuvni qabul qilmagan, uni tekshirish kerak.",
    steps: [
      "Tepadagi belgini bosing.",
      "«Server qabul qilmadi» bo'limida har yozuvning sababi yozilgan.",
      "Sababini tuzatib bo'lsa «Qayta yuborish» ni bosing.",
      "Yozuv keraksiz yoki ikki marta yozilgan bo'lsa — «O'chirish» (u serverga yuborilmaydi)."
    ],
    tips: [
      "O'chirishdan oldin rahbarga ko'rsating — unda pul yozuvi bo'lishi mumkin.",
      "Yuborilishini kutayotganlarni darhol yuborish — «Hozir yuborish»."
    ],
    related: ["internetsiz", "muammo-qotdi"]
  },

  /* ===================== YORDAMCHI ===================== */
  {
    id: "yordamchi",
    title: "AI yordamchi nima qila oladi",
    keys: ["yordamchi", "ai yordamchi", "sun'iy intellekt", "suniy intellekt", "robot", "yordam", "savol berish", "nima qila olasan", "sen kimsan", "admin telefoni", "adminga qongiroq", "malumot bermaydi", "nega aytmaysan", "pomosh"],
    who: "hamma",
    where: "Chap menyu → AI yordamchi",
    page: null,
    text: "Yordamchi dasturdan foydalanishni o'rgatadi: qayerda nima qilinadi, qaysi tugma bosiladi, muammo bo'lsa nima qilish kerak. Pul, hisobot raqamlari, mijozlar, mashina tarixi, telefonlar, parol va kodlarni aytmaydi — bunday ma'lumot uchun Adminga qo'ng'iroq qiling.",
    steps: [
      "Chap menyudan «AI yordamchi» ni oching.",
      "Savolni oddiy so'z bilan yozing (masalan: «qarzni qanday to'layman?») va «Yuborish» ni bosing.",
      "Javobdagi «… ni ochish» tugmasi kerakli sahifaga olib boradi.",
      "Suhbatni tozalash — «Tozalash»."
    ],
    tips: [
      "Xato yozsangiz ham tushunishga harakat qiladi; tushunmasa — boshqacha so'z bilan yozing.",
      "Internetsiz ham ishlaydi.",
      "Admin ismi va telefonini rahbar ⚙ (sozlash) tugmasidan, Maxsus parol bilan kiritadi."
    ],
    related: ["kim-nima", "maxsus", "muammo-qotdi"]
  }
];
