const fs = require('fs');
const path = require('path');

// Load original topics list (78 items)
const originalTopics = [
  { "id": 1, "question": "第一次約會的地點", "minDescription": "最災難 / 最不浪漫", "maxDescription": "最完美 / 最浪漫" },
  { "id": 2, "question": "如果中了樂透，你會買什麼？", "minDescription": "最無用 / 最浪費", "maxDescription": "最實用 / 最奢華" },
  { "id": 3, "question": "當你遲到的藉口", "minDescription": "最爛的藉口 / 一聽就是謊言", "maxDescription": "最完美的藉口 / 毫無破綻" },
  { "id": 4, "question": "最適合放在辦公室桌上的東西", "minDescription": "最令人反感 / 最不合適", "maxDescription": "最受歡迎 / 最合適" },
  { "id": 5, "question": "超能力：你想擁有的能力", "minDescription": "最廢 / 最沒用", "maxDescription": "最強大 / 最神級" },
  { "id": 6, "question": "去無人島只能帶一樣東西", "minDescription": "最愚蠢 / 最快死掉", "maxDescription": "最聰明 / 生存率最高" },
  { "id": 7, "question": "向心儀對象告白的一句話", "minDescription": "最尷尬 / 保證被拒絕", "maxDescription": "最動人 / 瞬間答應" },
  { "id": 8, "question": "買給男朋友/女朋友的生日禮物", "minDescription": "最災難 / 絕對分手", "maxDescription": "最貼心 / 當場痛哭流涕" },
  { "id": 9, "question": "如果世界末日明天來臨，今天要做什麼？", "minDescription": "最無聊 / 睡大覺", "maxDescription": "最瘋狂 / 最無憾" },
  { "id": 10, "question": "發明一個新的節日，這天要做什麼？", "minDescription": "最痛苦 / 最沒意義", "maxDescription": "最歡樂 / 全民慶祝" },
  { "id": 11, "question": "你在荒島求生時建造的庇護所", "minDescription": "豆腐渣工程 / 一吹就倒", "maxDescription": "豪華避難城堡 / 固若金湯" },
  { "id": 12, "question": "最完美的披薩配料組合", "minDescription": "黑暗料理 / 義大利人會憤怒", "maxDescription": "人間美味 / 廚神讚不絕口" },
  { "id": 13, "question": "搭乘長途飛機時隔壁乘客的行為", "minDescription": "極度討厭 / 崩潰想跳機", "maxDescription": "天使鄰座 / 貼心又安靜" },
  { "id": 14, "question": "推薦一部適合全家觀看的電影", "minDescription": "尷尬爆表 / 兒童不宜", "maxDescription": "神作 / 全家抱在一起痛哭流涕" },
  { "id": 15, "question": "去KTV必點的一首歌", "minDescription": "魔音傳腦 / 所有人落荒而逃", "maxDescription": "天籟之音 / 全場起立鼓掌安可" },
  { "id": 16, "question": "你的理想居住城市特點", "minDescription": "人間煉獄 / 垃圾滿地治安極差", "maxDescription": "世外桃源 / 治安完美風景如畫" },
  { "id": 17, "question": "用來當作傳家之寶的物品", "minDescription": "一文不值的破抹布", "maxDescription": "價值連城的稀世珍寶" },
  { "id": 18, "question": "最棒的舒壓放鬆方式", "minDescription": "越做越累 / 更加焦慮", "maxDescription": "身心靈極致昇華 / 宛如重生" },
  { "id": 19, "question": "一款新上市的手機APP功能", "minDescription": "垃圾軟體 / 下載即中毒", "maxDescription": "改變世界的超級神器" },
  { "id": 20, "question": "對上司說的真心話或客套話", "minDescription": "極度白目 / 當場被開除", "maxDescription": "馬屁大師 / 聽完直接升職加薪" },
  { "id": 21, "question": "【動物】如果你養了一隻恐龍，你會幫牠取什麼名字？", "minDescription": "超普通", "maxDescription": "超荒謬" },
  { "id": 22, "question": "【動物】如果你養了一隻龍，牠最奇怪的習慣是什麼？", "minDescription": "有點奇怪", "maxDescription": "完全不能理解" },
  { "id": 23, "question": "【動物】如果你的寵物突然開始會說話，它第一句會說什麼？", "minDescription": "很正常", "maxDescription": "超震撼" },
  { "id": 24, "question": "【動物】如果有一種新動物是你命名的，你會叫它什麼？", "minDescription": "很合理", "maxDescription": "亂取到生物老師想退休" },
  { "id": 25, "question": "【動物】如果你可以騎任何動物上班，你會選哪一種？", "minDescription": "合理", "maxDescription": "根本不可能" },
  { "id": 26, "question": "【超能力】如果你是超級英雄，你的能力是什麼？", "minDescription": "超沒用", "maxDescription": "神到作弊" },
  { "id": 27, "question": "【超能力】如果你是反派，你最大的絕招是什麼？", "minDescription": "暗黑/很弱", "maxDescription": "世界末日等級" },
  { "id": 28, "question": "【超能力】如果你能發明一個超能力，但只能用一次，你會選什麼？", "minDescription": "普通", "maxDescription": "改變世界" },
  { "id": 29, "question": "【超能力】如果你的超能力有副作用，那會是什麼？", "minDescription": "幾乎沒影響", "maxDescription": "超慘" },
  { "id": 30, "question": "【超能力】如果英雄協會要幫你取英雄名，你希望叫什麼？", "minDescription": "普通", "maxDescription": "中二到爆" },
  { "id": 31, "question": "【戀愛】如果你的另一半每天都要叫你一個暱稱，他會叫你什麼？", "minDescription": "普通", "maxDescription": "肉麻到不敢聽" },
  { "id": 32, "question": "【戀愛】如果第一次約會就送禮物，你會送什麼？", "minDescription": "很正常", "maxDescription": "超離譜" },
  { "id": 33, "question": "【戀愛】如果要用一道菜形容你的愛情，你會選哪一道？", "minDescription": "合理", "maxDescription": "完全想不到" },
  { "id": 34, "question": "【戀愛】如果要用一首歌當你的戀愛主題曲，會是哪種類型？", "minDescription": "很甜", "maxDescription": "超爆笑" },
  { "id": 35, "question": "【戀愛】如果你的愛情故事要拍成電影，片名叫什麼？", "minDescription": "普通", "maxDescription": "票房冠軍" },
  { "id": 36, "question": "【校園/工作】如果今天要翹課（班），你的理由是？", "minDescription": "合理", "maxDescription": "老師（老闆）直接傻眼" },
  { "id": 37, "question": "【校園/工作】如果主管突然請你上台演講，你會講什麼？", "minDescription": "正常", "maxDescription": "全公司瘋掉" },
  { "id": 38, "question": "【校園/工作】如果今天辦公室多了一條規定，是什麼？", "minDescription": "合理", "maxDescription": "沒人想上班" },
  { "id": 39, "question": "【校園/工作】如果同事送你一份神秘禮物，打開會是什麼？", "minDescription": "普通", "maxDescription": "超離譜" },
  { "id": 40, "question": "【校園/工作】如果今天可以換一個職業一天，你想當什麼？", "minDescription": "很合理", "maxDescription": "根本不可能" },
  { "id": 41, "question": "【日常】如果今天醒來，全世界的人都跟你一樣，你最擔心什麼？", "minDescription": "小事", "maxDescription": "世界毀滅" },
  { "id": 42, "question": "【日常】如果今天開始只能吃一種食物一年，你選什麼？", "minDescription": "很合理", "maxDescription": "沒人能理解" },
  { "id": 43, "question": "【日常】如果今天你的手機只能留一個 App，你留哪個？", "minDescription": "必需品", "maxDescription": "超怪" },
  { "id": 44, "question": "【日常】如果你可以把一樣東西變成粉紅色，你會選什麼？", "minDescription": "普通", "maxDescription": "超有病" },
  { "id": 45, "question": "【日常】如果你的冰箱只能放一種東西，會放什麼？", "minDescription": "合理", "maxDescription": "完全看不懂" },
  { "id": 46, "question": "【穿越】如果你穿越到古代，你第一件事會做什麼？", "minDescription": "很合理", "maxDescription": "超荒唐" },
  { "id": 47, "question": "【穿越】如果你穿越到恐龍時代，你最想做什麼？", "minDescription": "安全第一", "maxDescription": "找死" },
  { "id": 48, "question": "【穿越】如果你回到十歲，你第一句話會跟自己說什麼？", "minDescription": "普通建議", "maxDescription": "改變人生" },
  { "id": 49, "question": "【穿越】如果未來的你回來找你，他最可能提醒你什麼？", "minDescription": "小事", "maxDescription": "超震撼" },
  { "id": 50, "question": "【穿越】如果今天可以刪掉人生一天，你會刪哪一天？", "minDescription": "普通", "maxDescription": "超戲劇化" },
  { "id": 51, "question": "【奇幻】如果你收到霍格華茲入學通知，你第一件事會做什麼？", "minDescription": "正常", "maxDescription": "超荒謬" },
  { "id": 52, "question": "【奇幻】如果阿拉丁神燈可以實現一個願望，你會許什麼？", "minDescription": "普通", "maxDescription": "超有創意" },
  { "id": 53, "question": "【奇幻】如果可以發明一種魔法，你會發明什麼？", "minDescription": "方便生活", "maxDescription": "神到不行" },
  { "id": 54, "question": "【奇幻】如果今天開始，全世界都會說你的口頭禪，會是哪一句？", "minDescription": "普通", "maxDescription": "超洗腦" },
  { "id": 55, "question": "【奇幻】如果神燈精靈要求你付出代價，你願意付出什麼？", "minDescription": "很小", "maxDescription": "超大" },
  { "id": 56, "question": "【美食】如果可以發明一種新口味的珍珠奶茶，你會做什麼？", "minDescription": "可以接受", "maxDescription": "店員直接報警" },
  { "id": 57, "question": "【美食】如果泡麵推出一種新口味，你希望是？", "minDescription": "合理", "maxDescription": "超噁" },
  { "id": 58, "question": "【美食】如果披薩只能放一種配料，你選什麼？", "minDescription": "正常", "maxDescription": "義大利人會生氣" },
  { "id": 59, "question": "【美食】如果今天開一家餐廳，你最有特色的一道菜是？", "minDescription": "普通", "maxDescription": "挑戰味蕾極限" },
  { "id": 60, "question": "【美食】如果甜點可以變成主食，你選哪一種？", "minDescription": "合理", "maxDescription": "完全不健康" },
  { "id": 61, "question": "【腦洞】如果今天法律規定每個人都要養一種東西，你養什麼？", "minDescription": "合理", "maxDescription": "超奇怪" },
  { "id": 62, "question": "【腦洞】如果世界上新增一個節日，你希望大家慶祝什麼？", "minDescription": "普通", "maxDescription": "超荒謬" },
  { "id": 63, "question": "【腦洞】如果你的名字不是現在這個，你最希望叫什麼？", "minDescription": "很正常", "maxDescription": "爸媽會崩潰" },
  { "id": 64, "question": "【腦洞】如果你可以刪掉世界上一樣東西，你會刪什麼？", "minDescription": "小東西", "maxDescription": "影響全世界" },
  { "id": 65, "question": "【腦洞】如果今天變成一個物品，你想變成什麼？", "minDescription": "普通", "maxDescription": "超奇怪" },
  { "id": 66, "question": "【腦洞】如果你的房間會自己長出一樣東西，希望是什麼？", "minDescription": "實用", "maxDescription": "超荒唐" },
  { "id": 67, "question": "【腦洞】如果你可以重新發明一種交通工具，它會是什麼？", "minDescription": "有點創新", "maxDescription": "牛頓看到會哭" },
  { "id": 70, "question": "【腦洞】如果你的夢境可以直播，今天晚上大家會看到什麼？", "minDescription": "很普通", "maxDescription": "超展開" },
  { "id": 71, "question": "【腦洞】如果外星人要學習人類文化，你第一個會介紹什麼？", "minDescription": "很正常", "maxDescription": "完全誤導外星人" },
  { "id": 72, "question": "【腦洞】如果明天開始，全世界的人都要模仿你一天，你覺得哪件事最有趣？", "minDescription": "幾乎沒影響", "maxDescription": "整個世界大亂" },
  { "id": 73, "question": "【劇本-見網友①】你與聊了四個月的網友見面時發生了一件尷尬事，對方卻不介意。到底發生了什麼？", "minDescription": "有點尷尬，但可以帶過", "maxDescription": "尷尬到想搬去另一個國家" },
  { "id": 74, "question": "【劇本-見網友②】這件尷尬事反而讓對方覺得你很可愛。他到底從中發現了你什麼特質？", "minDescription": "普通的小優點", "maxDescription": "讓人認定想交往的大優點" },
  { "id": 75, "question": "【劇本-見網友③】隔天他傳訊息說：『其實昨天我有一句話一直沒敢說。』這句讓你不知道怎麼回覆的話是？", "minDescription": "有點心動", "maxDescription": "直接可以當偶像劇台詞" },
  { "id": 76, "question": "【劇本-見網友④】第二次吃火鍋約會時，隔壁桌突然站起來指著你的約會對象大喊：『原來你在這裡！』來的人是？", "minDescription": "完全沒影響", "maxDescription": "今天約會直接毀掉" },
  { "id": 77, "question": "【劇本-見網友⑤】回家後你翻遍對方的 IG 貼文，發現了一件讓你超級在意的事情。你發現了什麼？", "minDescription": "小小介意", "maxDescription": "直接想取消所有約會" },
  { "id": 78, "question": "【劇本-見網友⑥】一年後朋友問你們：『所以你們現在最大的感情危機是什麼？』你會怎麼回答？", "minDescription": "情侶都會遇到的小問題", "maxDescription": "每天都像戀愛實境秀" }
];

// Nouns lists
const animals = [
  "貓咪", "柯基犬", "恐龍", "獨角獸", "樹懶", "河馬", "企鵝", "倉鼠", "羊駝", "獅子", 
  "老虎", "鯊魚", "章魚", "飛鼠", "蝙蝠", "狐狸", "柴犬", "哈士奇", "水豚", "蜜獾", 
  "鴨嘴獸", "迅猛龍", "貓頭鷹", "青蛙", "無尾熊", "長頸鹿", "斑馬", "大象", "海牛", "變色龍", 
  "旅鼠", "渡渡鳥", "始祖鳥", "三角龍", "猛獁象", "噴火龍", "史萊姆", "哥吉拉", "九尾狐", "鳳凰", 
  "獅鷲", "奇美拉", "克蘇魯", "獨角仙", "螢火蟲", "蚊子", "蟑螂", "大熊貓", "樹精", "尼斯湖水怪"
];

const roles = [
  "超級英雄", "終極大反派", "傳奇忍者", "魔法學院教授", "絕地武士", "王牌特工", "名偵探", "太空人", "煉金術士", "馴龍高手", 
  "AI機器人", "加勒比海盜", "地獄廚神", "絕世劍客", "森林德魯伊", "遠古召喚獸", "地獄惡魔", "天堂天使", "古堡幽靈", "吸血鬼德古拉", 
  "荒野狼人", "地下城矮人", "精靈射手", "部落獸人", "半人馬戰士", "半魚人", "深海人魚", "黃金巨龍", "史萊姆國王", "骷髏將軍"
];

const food = [
  "珍珠奶茶", "排骨泡麵", "夏威夷披薩", "深坑臭豆腐", "泰國榴槤", "四川麻辣火鍋", "哈根達斯冰淇淋", "雙層牛肉漢堡", "日式生魚片壽司", "墨西哥捲餅", 
  "奶油義大利麵", "韓式銅盤烤肉", "印度咖哩飯", "台式滷肉飯", "沙朗牛排", "台式炸雞排", "日式章魚燒", "美式甜甜圈", "法式馬卡龍", "提拉米蘇", 
  "苦甜黑巧克力", "台式鹹酥雞", "凱薩沙拉", "鮭魚生魚片", "柳州螺螄粉", "日式納豆", "台式豬血糕", "新鮮香魚", "皮蛋豆腐", "黑糖剉冰"
];

const dailyItems = [
  "智慧型手機", "筆記型電腦", "液晶電視", "家用冰箱", "滾筒洗衣機", "微波爐", "儲熱式熱水器", "變頻冷氣機", "空氣清淨除濕機", "掃地機器人", 
  "免治馬桶", "雙人浴缸", "記憶床墊", "北歐風沙拉沙發", "實木衣櫃", "人體工學書桌", "電競椅子", "機械式鬧鐘", "LED檯燈", "全身鏡", 
  "木質梳子", "音波震動牙刷", "負離子吹風機", "陶瓷保溫杯", "不鏽鋼碗筷", "不鏽鋼湯匙", "毛絨拖鞋", "五指襪子", "純棉內褲", "絲綢睡衣", 
  "防風外套", "運動鞋", "毛呢帽子", "近視眼鏡", "感應式鑰匙", "真皮錢包", "雙肩背包", "自動折疊雨傘", "智慧手錶", "精裝筆記本"
];

// Generation loop
const generatedTopics = [];
let idCounter = 79;

// 1. Generate Animal Topics (50 * 4 = 200 items)
animals.forEach(animal => {
  generatedTopics.push({
    id: idCounter++,
    question: `【動物】如果你養了一隻${animal}，你會幫牠取什麼名字？`,
    minDescription: "名字超普通",
    maxDescription: "名字超荒謬"
  });
  generatedTopics.push({
    id: idCounter++,
    question: `【動物】如果你養了一隻${animal}，牠最奇怪的習慣會是什麼？`,
    minDescription: "有點奇怪",
    maxDescription: "完全不能理解"
  });
  generatedTopics.push({
    id: idCounter++,
    question: `【動物】如果你的寵物${animal}突然開始會說話，它第一句會說什麼？`,
    minDescription: "聽起來很正常",
    maxDescription: "讓人超震撼"
  });
  generatedTopics.push({
    id: idCounter++,
    question: `【動物】如果你可以騎著一隻${animal}上班，你覺得路人的反應是？`,
    minDescription: "看一眼就覺得合理",
    maxDescription: "根本不可能見到"
  });
});

// 2. Generate Superpower Topics (30 * 3 = 90 items)
roles.forEach(role => {
  generatedTopics.push({
    id: idCounter++,
    question: `【超能力】如果你是${role}，你最想擁有的能力是什麼？`,
    minDescription: "超級沒用",
    maxDescription: "強大到像開作弊"
  });
  generatedTopics.push({
    id: idCounter++,
    question: `【超能力】如果你是${role}，你最大的絕招是什麼？`,
    minDescription: "威力很弱",
    maxDescription: "世界末日等級"
  });
  generatedTopics.push({
    id: idCounter++,
    question: `【超能力】如果${role}有一個奇特的副作用，那會是什麼？`,
    minDescription: "幾乎沒影響",
    maxDescription: "體驗超級慘烈"
  });
});

// 3. Generate Food Topics (30 * 3 = 90 items)
food.forEach(item => {
  generatedTopics.push({
    id: idCounter++,
    question: `【美食】如果可以發明一種新口味的${item}，你會做什麼口味？`,
    minDescription: "大家可以接受",
    maxDescription: "店員直接選擇報警"
  });
  generatedTopics.push({
    id: idCounter++,
    question: `【美食】如果連鎖大廠要推出一款奇特的${item}新口味，你希望是？`,
    minDescription: "聽起來挺合理",
    maxDescription: "超噁心沒人敢試"
  });
  generatedTopics.push({
    id: idCounter++,
    question: `【美食】如果你的${item}只能放唯一一種配料，你會選什麼？`,
    minDescription: "非常正常",
    maxDescription: "義大利人會當場生氣"
  });
});

// 4. Generate Daily Items Topics (40 * 3 = 120 items)
dailyItems.forEach(item => {
  generatedTopics.push({
    id: idCounter++,
    question: `【日常】如果有一天早上醒來，發現全世界只剩你的${item}能用，你會？`,
    minDescription: "生活幾乎沒影響",
    maxDescription: "簡直直接崩潰"
  });
  generatedTopics.push({
    id: idCounter++,
    question: `【日常】如果你可以把你的一件${item}漆成亮粉紅色，你的感覺是？`,
    minDescription: "很普通沒特別",
    maxDescription: "超級有病好笑"
  });
  generatedTopics.push({
    id: idCounter++,
    question: `【日常】如果你的房間夜裡會自己默默長出一樣${item}，你希望是？`,
    minDescription: "非常實用",
    maxDescription: "超荒唐不知道要幹嘛"
  });
});

// Compile final array
const finalTopics = [...originalTopics, ...generatedTopics];

// Write to topics.json
fs.writeFileSync(
  path.join(__dirname, 'topics.json'),
  JSON.stringify(finalTopics, null, 2),
  'utf8'
);

console.log(`Generated ${finalTopics.length} topics successfully inside topics.json!`);
