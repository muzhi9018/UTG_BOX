import {MessageContext} from "@mtcute/dispatcher";
import {html} from '@mtcute/html-parser'
import {BasePlugin, PluginScope} from "../../src/core/base-plugin.js";
import {CommonSendParams} from "@mtcute/core/methods.js";


const mygCongratulatoryTemplates: string[] = [
    // 古风霸气剑意款（15条）
    `恭喜 <i>{{username}}</i> 登阁入册，墨云启卷，从此此间山河万象，皆入你眸，此间乾坤光影，皆为你掌！`,
    `墨云阁名册添名，<i>{{username}}</i> 阁下自此入局，以光影为刃，以帧画为锋，此间天地，任你纵览山河！`,
    `登阁成功！墨云阁为 <i>{{username}}</i> 覆天幕，星河为你映画屏，往后阅遍千帧万象，皆是你的江湖序章。`,
    `恭喜 <i>{{username}}</i> 入驻墨云阁，册名留痕，墨染青云，从此以视频为舟，渡遍此间山海风月，无往不利！`,
    `阁主之名已刻，墨云之力已予，<i>{{username}}</i> 自踏入此间，便执掌光影乾坤，观遍世间万象风华！`,
    `入阁加冕，墨云归心！<i>{{username}}</i> 从此方寸屏幕皆是江湖，每一帧画面，都是你的快意山河。`,
    `恭喜 <i>{{username}}</i> 解锁墨云阁身份，青云为笺，光影为墨，你的视界，自此落笔便是万丈星河。`,
    `登阁功成！墨卷启，云潮生，<i>{{username}}</i> 此间光影江湖，任你驰骋，万般精彩，皆为你而来。`,
    `墨云阁新晋行者 <i>{{username}}</i>，自此入局，以眸为镜，映尽千番光景，以心为剑，斩尽无趣平庸！`,
    `名册留名，墨云加身，恭喜 <i>{{username}}</i> 正式登临墨云之境，往后山河入梦，光影随行，万事皆顺。`,
    `入阁大吉！墨染九霄云，帧藏万里景，<i>{{username}}</i> 自今日起，便是这光影山河的执卷之人。`,
    `恭喜 <i>{{username}}</i> 阁下叩开墨云阁山门，心有丘壑，目有星河，从此方寸之间，尽览天地万象。`,
    `墨云在册，荣光加身，<i>{{username}}</i> 已跻身此间行者，往后每一次点开，皆是奔赴一场山河盛宴。`,
    `登阁加冕，万象归宗！墨云为 <i>{{username}}</i> 遮天，光影为你铺路，你的视界，从此再无边界。`,
    `恭喜 <i>{{username}}</i> 入驻墨云阁，以墨为魂，以云为翼，从此遨游光影星河，阅尽人间绝色风华。`,

    // 玄幻傲天觉醒款（15条）
    `账号激活成功！<i>{{username}}</i> 的「墨云视界」血脉已觉醒，从此解锁万象次元，执掌光影之力，战力全开！`,
    `恭喜 <i>{{username}}</i> 觉醒墨云阁专属身份，次元之门为你敞开，诸天万界的精彩画面，皆由你一键开启！`,
    `入阁加冕，灵力充盈！<i>{{username}}</i> 已成功绑定墨云阁主系统，从此观遍三界帧画，踏碎次元壁垒，所向披靡！`,
    `身份认证完成！墨云之力灌注完毕，<i>{{username}}</i> 的视界从此晋升至高维度，万般精彩，皆为你所独享！`,
    `恭喜 <i>{{username}}</i> 解锁「墨云行者」称号，你的精神领域已与墨云阁共鸣，从此光影为你所用，次元为你所控！`,
    `登阁成功！<i>{{username}}</i> 的专属次元通道已开启，从此穿梭于万千帧画之间，阅尽诸天万象，无人可挡！`,
    `血脉契合度100%，墨云阁席位已锁定！<i>{{username}}</i> 从此便是此间光影的主宰，每一帧，都是你的封神时刻。`,
    `恭喜 <i>{{username}}</i> 突破次元桎梏，登临墨云之境，从此手握光影权杖，执掌万千画面，开启你的专属传奇！`,
    `墨云阁已绑定，<i>{{username}}</i> 的视界天赋已觉醒，往后所见皆为星辰，所阅皆是巅峰，一往无前！`,
    `入阁大吉！<i>{{username}}</i> 的「帧画领域」已展开，从此以屏幕为阵，以画面为兵，横扫所有无趣，尽显锋芒！`,
    `账号开通，神力加身！<i>{{username}}</i> 已成为墨云阁的在册强者，从此遨游光影星河，纵横次元宇宙，无人匹敌！`,
    `恭喜 <i>{{username}}</i> 觉醒墨云专属视界，次元壁障对你形同虚设，万千精彩画面，皆是你征途的点缀！`,
    `墨云之名，刻入神魂，<i>{{username}}</i> 已正式入局，从此光影为伴，帧画为盟，你的传奇，自此开篇！`,
    `身份解锁成功！<i>{{username}}</i> 的精神力已链接墨云核心，从此所见之景，皆是天地馈赠，所向之处，皆是荣光！`,
    `恭喜 <i>{{username}}</i> 登临墨云阁，你的「万象观影」命格已激活，往后阅遍千番精彩，皆是你的渡劫升阶之路。`,

    // 温柔宿命羁绊款（10条）
    `恭喜 <i>{{username}}</i> 与墨云阁缔结契约，从此墨染云烟，光影为契，往后岁岁年年，皆有万千精彩伴你左右。`,
    `入阁成功，宿命相逢！墨云为 <i>{{username}}</i> 铺就光影长路，每一帧温柔与热血，都是为你量身而藏的风景。`,
    `名册留名，心意相通，恭喜 <i>{{username}}</i> 成为墨云阁的一员，从此山河万里，帧画千番，皆与你温柔相伴。`,
    `墨云启，相逢幸，恭喜 <i>{{username}}</i> 解锁此间温柔，从此屏幕之内是山海，屏幕之外是心安，万事皆甜。`,
    `契约生效，羁绊永存！<i>{{username}}</i> 与墨云阁的缘分自此开启，往后每一次观影，都是一场温柔的奔赴。`,
    `恭喜 <i>{{username}}</i> 入驻墨云阁，以心为引，以眸为证，从此光影入梦，山河入怀，所有美好，皆为你而来。`,
    `墨染青云，心向暖阳，恭喜 <i>{{username}}</i> 登阁成功，往后阅遍人间烟火，看尽星河浪漫，岁岁无忧。`,
    `<i>{{username}}</i> 的名字，刻入墨云书卷，从此光影为你温柔，帧画为你停留，所有精彩，皆恰逢其时。`,
    `入阁大吉，星河入梦！恭喜 <i>{{username}}</i> 与万千美好相逢，从此墨云相伴，光影随行，前路漫漫，皆是繁花。`,
    `契约缔结，荣光加冕，<i>{{username}}</i> 已成为墨云阁的守护者与见证者，往后所见所感，皆是世间温柔与滚烫。`,

    // 沙雕热血搞怪款
    `登阁成功！恭喜 <i>{{username}}</i> 喜提墨云阁常驻居民身份，从此摆烂追剧，热血刷番，快乐永不打烊！`,
    `墨云阁萌新 <i>{{username}}</i> 报到成功！你的快乐观影buff已叠满，从此无剧荒、无卡顿，一路爽到底！`,
    `入阁加冕！恭喜 <i>{{username}}</i> 解锁「墨云摆烂真君」称号，从此躺平看遍万千神剧，战力拉满，快乐封神！`,
    `账号开通大吉！<i>{{username}}</i> 的专属快乐通道已开启，从此横扫所有emo，帧帧都是快乐，秒秒都是精彩！`,
    `恭喜 <i>{{username}}</i> 入驻墨云阁，从此加入光影大军，左手刷番右手追剧，此间快乐，唯你独尊！`,
    `<i>{{username}}</i>，恭喜上岗！从此摸鱼观影两不误，快乐值直接拉满到溢出！`,
    `登阁功成！<i>{{username}}</i> 的「无敌观影」光环已激活，从此看遍天下好片，踩雷率为零，欧气爆棚！`,
    `恭喜 <i>{{username}}</i> 成功混入墨云阁核心圈层，从此山河万里任你看，千番精彩任你选，主打一个随心所欲！`,
    `入阁成功，快乐加冕！<i>{{username}}</i> 的人生只有两种状态：在看片，和准备看片，快乐无限循环！`,
    `墨云阁认证通过！恭喜 <i>{{username}}</i> 成为「光影摆烂大师」，往后追剧刷番无压力，快乐才是唯一真理！`,
    `登阁成功！<i>{{username}}</i> 从此成为墨云阁摸鱼追剧大使，上班看片不翻车，快乐直接起飞！`,
    `恭喜 <i>{{username}}</i> 喜提墨云阁咸鱼身份，从此剧荒是路人，摆烂追剧才是人生真谛！`,
    `墨云阁认证通过！<i>{{username}}</i> 解锁“带薪看片”隐藏成就，从此摸鱼有理，追剧无罪！`,
    `入阁大吉！<i>{{username}}</i> 你的追剧外挂已到账，无广告、不卡顿，摆烂到天荒地老！`,
    `恭喜 <i>{{username}}</i> 混入墨云阁核心摆烂圈层，从此左手肥宅快乐水，右手刷番到天黑！`,
    `登阁功成！<i>{{username}}</i> 荣获“墨云阁追剧废柴”称号，从此告别emo，只做快乐追剧人！`,
    `墨云阁萌新 <i>{{username}}</i> 报到！你的快乐额度已充满，追剧刷番无限续杯，永不打烊！`,
    `恭喜 <i>{{username}}</i> 解锁墨云阁“躺平看片”终极权限，从此床和沙发，就是你的追剧江山！`,
    `入阁加冕！<i>{{username}}</i> 从此成为墨云阁带薪摸鱼第一人，看片看到老板流泪，快乐到起飞！`,
    `恭喜 <i>{{username}}</i> 绑定墨云阁追剧系统，从此告别选择困难，所有好片主动上门，欧气爆棚！`,
    `登阁成功！<i>{{username}}</i> 的“熬夜追剧”buff已叠满，头发掉光也挡不住看片的快乐！`,
    `恭喜 <i>{{username}}</i> 成为墨云阁“追剧摆烂真君”，从此剧比天大，工作靠边，快乐至上！`,
    `入阁大吉！<i>{{username}}</i> 解锁“看片不踩雷”隐藏技能，从此所有烂片绕着走，神剧看到够！`,
    `恭喜 <i>{{username}}</i> 登临墨云阁，从此人生只有两个目标：看完这部剧，再看下一部剧！`
];

// 白名单模板
const whitelistTemplates: { [key: string]: string[] } = {
    '红': [
        `恭喜 <i>{{username}}</i> 登临墨云阁红名单！赤焰加身，荣光加冕，从此执掌光影至尊权，阅尽万千神剧无阻碍！`,
        `红名单席位锁定！<i>{{username}}</i> 以赤血为契，以荣光为证，从此墨云之内，你便是最炽热的高阶行者，万般特权尽在掌握！`,
        `墨云阁红名单激活成功！<i>{{username}}</i> 赤焰护体，战力飙升，从此横扫所有限制，帧帧精彩皆为你独享，霸气无双！`,
        `恭喜 <i>{{username}}</i> 解锁红名单至尊身份！赤霞覆天幕，荣光照前程，往后观影无边界，墨云之内，你便是规则本身！`,
        `红名单在册，炽焰归心！<i>{{username}}</i> 从此跻身墨云阁核心高阶圈层，专属通道开启，万般精彩，皆为你优先呈现！`,
        `墨云红焰，为你燃尽！<i>{{username}}</i> 红名单开通大吉，从此手握赤焰权杖，执掌观影特权，所向披靡，无人可及！`,
        `恭喜 <i>{{username}}</i> 荣登红名单，赤焰之力灌注完毕，从此墨云阁内，你享有至高优先权，所有美好，皆为你率先绽放！`,
        `红名单身份认证通过！<i>{{username}}</i> 从此身披赤焰荣光，告别所有桎梏，遨游光影星河，快意潇洒，无往不利！`,
        `红名单新晋尊者 <i>{{username}}</i>，从此以赤焰为刃，斩尽所有无趣，以荣光为盾，护你观影无忧，高阶体验拉满！`,
        `恭喜 <i>{{username}}</i> 开通红名单，赤焰封神，万象归宗，从此墨云之内，你的视界，便是最高规格，万般精彩，尽在囊中！`
    ],
    '橙': [
        `恭喜 <i>{{username}}</i> 解锁墨云阁橙名单！鎏金暖阳加身，高阶特权开启，从此观影之路，温暖璀璨，无往而不利！`,
        `橙名单席位在册！<i>{{username}}</i> 以金橙为契，以专属为证，从此墨云之内，享有高阶观影特权，万般精彩，皆为你倾心呈现！`,
        `墨云阁橙名单激活成功！<i>{{username}}</i> 霞光护体，尊享加身，从此告别卡顿与广告，遨游光影世界，温润又潇洒！`,
        `恭喜 <i>{{username}}</i> 登临橙名单高阶身份！金橙覆路，荣光随行，往后墨云阁内，专属通道为你敞开，所有美好，皆可优先拥有！`,
        `橙名单认证通过，暖阳归心！<i>{{username}}</i> 从此跻身墨云阁高阶行者之列，帧帧精彩无遗漏，万般特权，尽在你的掌握！`,
        `金橙霞光，为你铺就！<i>{{username}}</i> 橙名单开通大吉，从此手握鎏金特权，观影之路一路坦途，温润璀璨，快意无限！`,
        `恭喜 <i>{{username}}</i> 荣登橙名单，暖阳之力灌注完毕，从此墨云之内，你享有专属高阶体验，所有神剧，皆为你优先解锁！`,
        `橙名单身份加冕成功！<i>{{username}}</i> 从此身披金橙霞光，告别所有观影限制，纵横光影星河，温暖又霸气，尊享无双！`,
        `墨云阁橙名单新晋尊享者 <i>{{username}}</i>，从此以金橙为翼，遨游光影山海，以专属为盾，护你观影无忧，高阶体验拉满！`,
        `恭喜 <i>{{username}}</i> 开通橙名单，鎏金封神，专属尊享，从此墨云之内，你的视界，便是温润高光，万般精彩，尽在怀中！`
    ],
    '黄': [
        `恭喜 <i>{{username}}</i> 登临墨云阁黄名单！鎏金帝王加身，王者权威加冕，从此执掌墨云观影权，万般精彩，皆为你独尊！`,
        `黄名单席位锁定！<i>{{username}}</i> 以黄金为契，以王者为证，从此墨云之内，你便是最高阶的观影王者，所有特权，尽归你有！`,
        `墨云阁黄名单激活成功！<i>{{username}}</i> 金甲护体，王者战力飙升，从此横扫所有观影限制，帧帧神剧，皆为你独享，霸气侧漏！`,
        `恭喜 <i>{{username}}</i> 解锁黄名单帝王身份！黄金覆天幕，王者照前程，往后墨云阁内，你便是规则的制定者，观影之路，无人可挡！`,
        `黄名单在册，王者归心！<i>{{username}}</i> 从此跻身墨云阁核心王者圈层，专属帝王通道开启，万般精彩，皆为你优先呈现，至尊无双！`,
        `墨云黄金，为你铸就！<i>{{username}}</i> 黄名单开通大吉，从此手握帝王权杖，执掌观影无上特权，所向披靡，傲视群雄！`,
        `恭喜 <i>{{username}}</i> 荣登黄名单，王者之力灌注完毕，从此墨云之内，你享有帝王级优先权，所有美好，皆为你率先绽放，尊贵无比！`,
        `黄名单身份认证通过！<i>{{username}}</i> 从此身披鎏金王者荣光，告别所有桎梏，遨游光影星河，快意潇洒，王者风范尽显！`,
        `墨云阁黄名单新晋帝王 <i>{{username}}</i>，从此以黄金为刃，斩尽所有无趣，以王者为盾，护你观影无忧，帝王级体验拉满！`,
        `恭喜 <i>{{username}}</i> 开通黄名单，鎏金封神，王者归宗，从此墨云之内，你的视界，便是帝王规格，万般精彩，尽在掌中！`
    ],
    '绿': [
        `恭喜 <i>{{username}}</i> 解锁墨云阁绿名单！青木灵韵加身，秘境特权开启，从此遨游光影秘境，生机盎然，无往而不利！`,
        `绿名单席位在册！<i>{{username}}</i> 以青藤为契，以秘境为证，从此墨云之内，享有专属秘境观影权，万般精彩，皆为你倾心呈现！`,
        `墨云阁绿名单激活成功！<i>{{username}}</i> 灵木护体，灵动加身，从此告别卡顿与广告，穿梭光影秘境，潇洒又自在！`,
        `恭喜 <i>{{username}}</i> 登临绿名单秘境身份！青木覆路，灵韵随行，往后墨云阁内，专属秘境通道为你敞开，所有美好，皆可优先拥有！`,
        `绿名单认证通过，灵韵归心！<i>{{username}}</i> 从此跻身墨云阁秘境行者之列，帧帧精彩无遗漏，万般特权，尽在你的掌握，灵动无双！`,
        `青木灵韵，为你滋养！<i>{{username}}</i> 绿名单开通大吉，从此手握秘境权杖，观影之路一路坦途，生机盎然，快意无限！`,
        `恭喜 <i>{{username}}</i> 荣登绿名单，灵木之力灌注完毕，从此墨云之内，你享有专属秘境体验，所有神剧，皆为你优先解锁，灵动无比！`,
        `绿名单身份加冕成功！<i>{{username}}</i> 从此身披青木灵韵，告别所有观影限制，纵横光影秘境，灵动又霸气，尊享无双！`,
        `墨云阁绿名单新晋秘境行者 <i>{{username}}</i>，从此以青藤为翼，遨游光影山海，以秘境为盾，护你观影无忧，秘境级体验拉满！`,
        `恭喜 <i>{{username}}</i> 开通绿名单，青木封神，秘境尊享，从此墨云之内，你的视界，便是灵动秘境，万般精彩，尽在怀中！`
    ],
    '青': [
        `恭喜 <i>{{username}}</i> 登临墨云阁青名单！青云加身，仙者加冕，从此执掌光影仙权，阅尽万千神剧，飘逸又自在！`,
        `青名单席位锁定！<i>{{username}}</i> 以青云为契，以仙者为证，从此墨云之内，你便是高阶的观影仙者，万般特权，尽在掌握，清冷无双！`,
        `墨云阁青名单激活成功！<i>{{username}}</i> 清辉护体，仙力飙升，从此横扫所有限制，帧帧精彩皆为你独享，仙风傲骨，无人可及！`,
        `恭喜 <i>{{username}}</i> 解锁青名单仙者身份！青云覆天幕，仙光照前程，往后观影无边界，墨云之内，你便是仙阶行者，快意潇洒！`,
        `青名单在册，青云归心！<i>{{username}}</i> 从此跻身墨云阁核心仙阶圈层，专属仙路开启，万般精彩，皆为你优先呈现，仙尊无双！`,
        `墨云青云，为你铺就！<i>{{username}}</i> 青名单开通大吉，从此手握青云权杖，执掌观影仙级特权，所向披靡，仙风尽显！`,
        `恭喜 <i>{{username}}</i> 荣登青名单，仙力灌注完毕，从此墨云之内，你享有仙阶优先权，所有美好，皆为你率先绽放，清冷又尊贵！`,
        `青名单身份认证通过！<i>{{username}}</i> 从此身披青云荣光，告别所有桎梏，遨游光影星河，仙风飘逸，无往不利！`,
        `墨云阁青名单新晋仙者 <i>{{username}}</i>，从此以青云为刃，斩尽所有无趣，以仙力为盾，护你观影无忧，仙阶体验拉满！`,
        `恭喜 <i>{{username}}</i> 开通青名单，青云封神，万象归宗，从此墨云之内，你的视界，便是仙阶规格，万般精彩，尽在囊中！`
    ],
    '蓝': [
        `恭喜 <i>{{username}}</i> 解锁墨云阁蓝名单！沧澜加身，深海加冕，从此执掌光影海域权，阅尽万千神剧，磅礴又霸气！`,
        `蓝名单席位在册！<i>{{username}}</i> 以深海为契，以沧澜为证，从此墨云之内，你便是高阶的观影海域主宰，万般特权，尽在掌握！`,
        `墨云阁蓝名单激活成功！<i>{{username}}</i> 碧波护体，海力飙升，从此横扫所有限制，帧帧精彩皆为你独享，深邃无双，无人可及！`,
        `恭喜 <i>{{username}}</i> 登临蓝名单海域身份！沧澜覆天幕，深海照前程，往后观影无边界，墨云之内，你便是海域行者，快意潇洒！`,
        `蓝名单认证通过，沧澜归心！<i>{{username}}</i> 从此跻身墨云阁核心海域圈层，专属海路开启，万般精彩，皆为你优先呈现，磅礴无双！`,
        `墨云沧澜，为你铸就！<i>{{username}}</i> 蓝名单开通大吉，从此手握深海权杖，执掌观影海域特权，所向披靡，海风范尽显！`,
        `恭喜 <i>{{username}}</i> 荣登蓝名单，海力灌注完毕，从此墨云之内，你享有海域优先权，所有美好，皆为你率先绽放，深邃又尊贵！`,
        `蓝名单身份加冕成功！<i>{{username}}</i> 从此身披沧澜荣光，告别所有桎梏，遨游光影星河，磅礴飘逸，无往不利！`,
        `墨云阁蓝名单新晋海域主宰 <i>{{username}}</i>，从此以沧澜为刃，斩尽所有无趣，以海力为盾，护你观影无忧，海域级体验拉满！`,
        `恭喜 <i>{{username}}</i> 开通蓝名单，沧澜封神，万象归宗，从此墨云之内，你的视界，便是海域规格，万般精彩，尽在囊中！`
    ],
    '紫': [
        `恭喜 <i>{{username}}</i> 登临墨云阁紫名单！紫金加身，神秘加冕，从此执掌光影秘境权，阅尽万千神剧，奢华又霸气！`,
        `紫名单席位锁定！<i>{{username}}</i> 以紫金为契，以神秘为证，从此墨云之内，你便是最高阶的观影秘境主宰，万般特权，尽归你有！`,
        `墨云阁紫名单激活成功！<i>{{username}}</i> 紫气护体，神秘战力飙升，从此横扫所有观影限制，帧帧神剧，皆为你独享，神秘无双！`,
        `恭喜 <i>{{username}}</i> 解锁紫名单神秘身份！紫金覆天幕，神秘照前程，往后墨云阁内，你便是秘境的制定者，观影之路，无人可挡！`,
        `紫名单在册，紫气归心！<i>{{username}}</i> 从此跻身墨云阁核心神秘圈层，专属紫金通道开启，万般精彩，皆为你优先呈现，至尊无双！`,
        `墨云紫金，为你铸就！<i>{{username}}</i> 紫名单开通大吉，从此手握神秘权杖，执掌观影无上特权，所向披靡，傲视群雄！`,
        `恭喜 <i>{{username}}</i> 荣登紫名单，神秘之力灌注完毕，从此墨云之内，你享有紫金级优先权，所有美好，皆为你率先绽放，奢华无比！`,
        `紫名单身份认证通过！<i>{{username}}</i> 从此身披紫金神秘荣光，告别所有桎梏，遨游光影星河，快意潇洒，神秘风范尽显！`,
        `墨云阁紫名单新晋神秘主宰 <i>{{username}}</i>，从此以紫金为刃，斩尽所有无趣，以神秘为盾，护你观影无忧，紫金级体验拉满！`,
        `恭喜 <i>{{username}}</i> 开通紫名单，紫金封神，神秘归宗，从此墨云之内，你的视界，便是紫金规格，万般精彩，尽在掌中！`
    ],
    '白': [
        `恭喜 <i>{{username}}</i> 解锁墨云阁白名单！皓月清辉加身，无瑕特权开启，从此遨游光影世界，纯净又潇洒！`,
        `白名单席位在册！<i>{{username}}</i> 以皓月为契，以无瑕为证，从此墨云之内，享有专属无瑕观影权，万般精彩，皆为你倾心呈现！`,
        `墨云阁白名单激活成功！<i>{{username}}</i> 清辉护体，无瑕加身，从此告别卡顿与广告，穿梭光影星河，清冷又自在！`,
        `恭喜 <i>{{username}}</i> 登临白名单无瑕身份！皓月覆路，清辉随行，往后墨云阁内，专属无瑕通道为你敞开，所有美好，皆可优先拥有！`,
        `白名单认证通过，清辉归心！<i>{{username}}</i> 从此跻身墨云阁无瑕行者之列，帧帧精彩无遗漏，万般特权，尽在你的掌握，无瑕无双！`,
        `皓月清辉，为你铺就！<i>{{username}}</i> 白名单开通大吉，从此手握无瑕权杖，观影之路一路坦途，纯净璀璨，快意无限！`,
        `恭喜 <i>{{username}}</i> 荣登白名单，皓月之力灌注完毕，从此墨云之内，你享有专属无瑕体验，所有神剧，皆为你优先解锁，纯净无比！`,
        `白名单身份加冕成功！<i>{{username}}</i> 从此身披皓月清辉，告别所有观影限制，纵横光影星河，清冷又霸气，尊享无双！`,
        `墨云阁白名单新晋无瑕尊者 <i>{{username}}</i> ，从此以皓月为翼，遨游光影山海，以无瑕为盾，护你观影无忧，无瑕级体验拉满！`,
        `恭喜 <i>{{username}}</i> 开通白名单，皓月封神，无瑕尊享，从此墨云之内，你的视界，便是纯净高光，万般精彩，尽在怀中！`
    ],
    '黑': [
        `恭喜 <i>{{username}}</i> 登临墨云阁黑名单！暗夜魅影加身，禁忌加冕，从此执掌光影禁忌权，阅尽万千神剧，暗黑又霸气！`,
        `黑名单席位锁定！<i>{{username}}</i> 以暗夜为契，以禁忌为证，从此墨云之内，你便是最高阶的观影禁忌主宰，万般特权，尽归你有，无人敢挡！`,
        `墨云阁黑名单激活成功！<i>{{username}}</i> 暗影护体，禁忌战力飙升，从此横扫所有观影限制，帧帧神剧，皆为你独享，暗黑无双，傲视群雄！`,
        `恭喜 <i>{{username}}</i> 解锁黑名单禁忌身份！暗夜覆天幕，禁忌照前程，往后墨云阁内，你便是规则的打破者，观影之路，畅通无阻，霸气侧漏！`,
        `黑名单在册，暗夜归心！<i>{{username}}</i> 从此跻身墨云阁核心禁忌圈层，专属暗影通道开启，万般精彩，皆为你优先呈现，禁忌无双！`,
        `墨云暗夜，为你铸就！<i>{{username}}</i> 黑名单开通大吉，从此手握禁忌权杖，执掌观影无上特权，所向披靡，暗黑风范尽显！`,
        `恭喜 <i>{{username}}</i> 荣登黑名单，禁忌之力灌注完毕，从此墨云之内，你享有暗黑级优先权，所有美好，皆为你率先绽放，禁忌又尊贵！`,
        `黑名单身份认证通过！<i>{{username}}</i> 从此身披暗夜魅影荣光，告别所有桎梏，遨游光影星河，快意潇洒，暗黑魅力爆棚！`,
        `墨云阁黑名单新晋禁忌主宰 <i>{{username}}</i>，从此以暗影为刃，斩尽所有无趣，以禁忌为盾，护你观影无忧，禁忌级体验拉满！`,
        `恭喜 <i>{{username}}</i> 开通黑名单，暗夜封神，禁忌归宗，从此墨云之内，你的视界，便是暗黑规格，万般精彩，尽在掌中，无人可及！`
    ],
    '粉': [
        `恭喜 <i>{{username}}</i> 解锁墨云阁粉名单！粉黛甜柔加身，元气特权开启，从此遨游光影世界，甜美又灵动，快乐无限！`,
        `粉名单席位在册！<i>{{username}}</i> 以粉黛为契，以元气为证，从此墨云之内，享有专属软萌观影权，万般精彩，皆为你倾心呈现，甜度拉满！`,
        `墨云阁粉名单激活成功！<i>{{username}}</i> 粉霞护体，元气加身，从此告别卡顿与广告，穿梭光影星河，软萌又自在，快乐无边！`,
        `恭喜 <i>{{username}}</i> 登临粉名单元气身份！粉黛覆路，元气随行，往后墨云阁内，专属软萌通道为你敞开，所有美好，皆可优先拥有，甜美无双！`,
        `粉名单认证通过，甜柔归心！<i>{{username}}</i> 从此跻身墨云阁元气行者之列，帧帧精彩无遗漏，万般特权，尽在你的掌握，软萌无敌！`,
        `粉黛霞光，为你铺就！<i>{{username}}</i> 粉名单开通大吉，从此手握元气权杖，观影之路一路坦途，甜美璀璨，快意无限，快乐爆棚！`,
        `恭喜 <i>{{username}}</i> 荣登粉名单，元气之力灌注完毕，从此墨云之内，你享有专属软萌体验，所有神剧，皆为你优先解锁，甜美无比！`,
        `粉名单身份加冕成功！<i>{{username}}</i> 从此身披粉黛甜柔荣光，告别所有观影限制，纵横光影星河，软萌又霸气，尊享无双，甜度超标！`,
        `墨云阁粉名单新晋元气尊者 <i>{{username}}</i>，从此以粉黛为翼，遨游光影山海，以元气为盾，护你观影无忧，元气级体验拉满，快乐无边！`,
        `恭喜 <i>{{username}}</i> 开通粉名单，粉黛封神，元气尊享，从此墨云之内，你的视界，便是甜美高光，万般精彩，尽在怀中，甜度拉满！`
    ],
    '涩': [
        `恭喜 <i>{{username}}</i> 登临墨云阁涩名单！绯色魅惑加身，秘境加冕，从此执掌光影绯色权，阅尽万千神剧，魅惑又霸气，无人可及！`,
        `涩名单席位锁定！<i>{{username}}</i> 以绯色为契，以魅惑为证，从此墨云之内，你便是高阶的观影魅惑主宰，万般特权，尽在掌握，神秘无双！`,
        `墨云阁涩名单激活成功！<i>{{username}}</i> 绯霞护体，魅惑战力飙升，从此横扫所有限制，帧帧精彩皆为你独享，魅惑十足，傲视群雄！`,
        `恭喜 <i>{{username}}</i> 解锁涩名单魅惑身份！绯色覆天幕，秘境照前程，往后观影无边界，墨云之内，你便是绯色行者，快意潇洒，魅力爆棚！`,
        `涩名单在册，绯色归心！<i>{{username}}</i> 从此跻身墨云阁核心绯色圈层，专属魅惑通道开启，万般精彩，皆为你优先呈现，神秘无双！`,
        `墨云绯色，为你铸就！<i>{{username}}</i> 涩名单开通大吉，从此手握魅惑权杖，执掌观影绯色特权，所向披靡，魅惑风范尽显！`,
        `恭喜 <i>{{username}}</i> 荣登涩名单，魅惑之力灌注完毕，从此墨云之内，你享有绯色级优先权，所有美好，皆为你率先绽放，神秘又尊贵！`,
        `涩名单身份认证通过！<i>{{username}}</i> 从此身披绯色魅惑荣光，告别所有桎梏，遨游光影星河，快意潇洒，魅惑魅力爆棚，无人可挡！`,
        `墨云阁涩名单新晋魅惑主宰 <i>{{username}}</i>，从此以绯色为刃，斩尽所有无趣，以魅惑为盾，护你观影无忧，绯色级体验拉满，魅力无限！`,
        `恭喜 <i>{{username}}</i> 开通涩名单，绯色封神，魅惑归宗，从此墨云之内，你的视界，便是绯色规格，万般精彩，尽在囊中，魅惑无双！`
    ]
}

// 夸女生模板
const praiseGirlTemplates = [
    `<i>{{username}}</i>你身上的温柔，真的能治愈所有不开心`,
    `<i>{{username}}</i>你性格也太好了吧，跟你相处特别舒服自在`,
    `<i>{{username}}</i>你笑起来的时候，感觉整个世界都变温柔了`,
    `<i>{{username}}</i>你真的太可爱了吧，一举一动都戳中人心巴`,
    `<i>{{username}}</i>你的可爱是自带的元气，一点都不刻意，太招人喜欢了`,
    `<i>{{username}}</i>你笑起来的样子甜度超标，可爱到犯规啦`,
    `<i>{{username}}</i>你真的太有气质了，这种气质真的是骨子里的，太迷人了`,
    `<i>{{username}}</i>你身上的氛围感绝了，清冷又温柔，高级又耐看`,
    `<i>{{username}}</i>你不是一眼惊艳，是越看越好看的耐看型，太有味道了`,
    `<i>{{username}}</i>你真的又优秀又清醒，活得太通透太飒了`,
    `<i>{{username}}</i>你不仅长得好看，能力还这么强，真的是宝藏女孩`,
    `<i>{{username}}</i>你的声音好好听，温柔又软糯，听你说话太治愈了`,
    `<i>{{username}}</i>你品味也太好了吧，不管穿搭还是审美，都特别有格调`,
    `<i>{{username}}</i>世间万般美好，都不及你的眉眼一笑`,
    `<i>{{username}}</i>遇见你之后，才知道什么叫一眼心动，满心欢喜`,
    `<i>{{username}}</i>，人如其名，既有墨的深邃，又有白的纯粹。`,
    `认识<i>{{username}}</i>之后，我才真正懂了“惊艳了时光，温柔了岁月”。`,
    `<i>{{username}}</i>，你的存在本身就是一幅行走的水墨画。`,
    `世界上美好的形容词，都适合用来形容<i>{{username}}</i>。`,
    `<i>{{username}}</i>一笑，我的世界就亮了。`,
    `怎么办，我好像被一个叫<i>{{username}}</i>的女孩深深吸引了。`,
    `<i>{{username}}</i>的魅力在于，她明明可以靠颜值，却偏偏靠才华。`,
    `今天也是为<i>{{username}}</i>的智慧和优雅倾倒的一天。`,
    `<i>{{username}}</i>，你认真做事的样子，散发着迷人的光。`,
    `能成为<i>{{username}}</i>的朋友，是我莫大的幸运。`,
    `<i>{{username}}</i>的温柔，是那种能融化一切坚冰的力量。`,
    `所有关于美好的想象，在见到<i>{{username}}</i>的那一刻都有了画面。`,
    `<i>{{username}}</i>，你让“气质”这个词有了具体的模样。`,
    `每次和<i>{{username}}</i>聊天，都感觉受益匪浅。`,
    `<i>{{username}}</i>的内心世界，一定比星空更辽阔璀璨。`,
    `夸人这件事，在<i>{{username}}</i>身上我可以永不词穷。`,
    `<i>{{username}}</i>，你就是“优雅永不过时”的活体证明。`,
    `有什么烦心事，只要看到<i>{{username}}</i>就能被治愈一大半。`,
    `<i>{{username}}</i>的善良，是刻在骨子里的教养。`,
    `<i>{{username}}</i>这个名字，注定就写满了故事与风采。`,
    `我宣布，<i>{{username}}</i>就是我心中的“人间理想型”。`,
    `<i>{{username}}</i>的想法总是那么独特又充满创意。`,
    `<i>{{username}}</i>，你连名字都这么好听，让人过耳不忘。`,
    `有<i>{{username}}</i>在的场合，连空气都变得清新宜人了。`,
    `<i>{{username}}</i>对待生活的态度，是我一直想学习的样子。`,
    `如果美好有代名词，那一定叫“<i>{{username}}</i>”。`,
    `<i>{{username}}</i>的坚韧，像墨迹一样力透纸背。`,
    `<i>{{username}}</i>的纯粹，像白色一样不染尘埃。`,
    `能遇见<i>{{username}}</i>，大概是花光了我所有的好运气。`,
    `<i>{{username}}</i>，你是我见过把“简单”穿出最高级感的人。`,
    `<i>{{username}}</i>的眼睛里，藏着星辰大海和万丈柔情。`,
    `<i>{{username}}</i>出手，就没有解决不了的难题。`,
    `<i>{{username}}</i>的幽默感，是顶级又舒服的那种。`,
    `<i>{{username}}</i>的格局和眼界，总是让我由衷佩服。`,
    `今天有没有人告诉<i>{{username}}</i>，你又比昨天更迷人了？`,
    `<i>{{username}}</i>的陪伴，是这世上最好的礼物之一。`,
    `<i>{{username}}</i>的真诚，是这个时代最稀缺的宝藏。`,
    `一想到世界上有<i>{{username}}</i>这么美好的人，就觉得人间值得。`,
    `<i>{{username}}</i>，你的声音是我听过最动听的旋律之一。`,
    `<i>{{username}}</i>对朋友的仗义，让人安全感满满。`,
    `<i>{{username}}</i>的品味，无论是审美还是选人，都一流。`,
    `<i>{{username}}</i>的笑容，具有百分百的治愈力。`,
    `<i>{{username}}</i>的细心和体贴，总是体现在最微小的细节里。`,
    `<i>{{username}}</i>，你就是“反差萌”本人，外表清冷，内心温暖。`,
    `我永远为<i>{{username}}</i>的独立和自信着迷。`,
    `<i>{{username}}</i>的成长速度，快得让人惊叹又钦佩。`,
    `<i>{{username}}</i>的存在，让我想成为一个更好的人。`,
    `如果我是导演，我故事里所有完美女主角都叫<i>{{username}}</i>。`,
    `<i>{{username}}</i>，愿你永远如今日这般，光芒万丈，自在如风。`,
    `最后的最后，只想说：<i>{{username}}</i>，你真好，认识你真好。`
];

// 夸男生模板
const praiseBoyTemplates: string[] = [
    `<i>{{username}}</i>，这名字真酷，像夜空一样深邃迷人。`,
    `<i>{{username}}</i>身上有种不动声色的力量，可靠极了。`,
    `果然，叫<i>{{username}}</i>的男生，气质都这么出众。`,
    `<i>{{username}}</i>的眼光很独到，看事情总能直击核心。`,
    `有<i>{{username}}</i>在的团队，就像有了定海神针。`,
    `<i>{{username}}</i>的幽默，是那种高级的、耐人寻味的。`,
    `<i>{{username}}</i>的执行力，就像浓墨重彩的一笔，干脆利落。`,
    `<i>{{username}}</i>，你思考时的侧脸，像一座沉稳的山峰。`,
    `<i>{{username}}</i>的内心世界，一定丰富得像一幅泼墨山水。`,
    `<i>{{username}}</i>的担当，是“事了拂衣去，深藏身与名”的那种帅。`,
    `<i>{{username}}</i>的靠谱，是大家公认的第一名。`,
    `<i>{{username}}</i>话不多，但每一句都很有分量。`,
    `<i>{{username}}</i>的品味真好，低调中透着高级感。`,
    `遇到难题？找<i>{{username}}</i>就对了。`,
    `<i>{{username}}</i>的坚韧，像墨一样，经得起时光研磨。`,
    `<i>{{username}}</i>，你笑起来很有感染力，像阳光穿透乌云。`,
    `<i>{{username}}</i>的专注力，强大到让人钦佩。`,
    `<i>{{username}}</i>对朋友，那是真正的“铁肩担道义”。`,
    `<i>{{username}}</i>做事，有种不张扬但必然成功的霸气。`,
    `<i>{{username}}</i>的格局，比他的名字更开阔。`,
    `<i>{{username}}</i>的冷静，在关键时刻太有魅力了。`,
    `<i>{{username}}</i>，你身上有种老派又迷人的绅士风度。`,
    `<i>{{username}}</i>的创意，像暗夜中的烟火，惊艳众人。`,
    `<i>{{username}}</i>的责任心，是他最闪耀的徽章。`,
    `和<i>{{username}}</i>聊天，总能学到新东西。`,
    `<i>{{username}}</i>的运动范儿，充满了荷尔蒙的张力。`,
    `<i>{{username}}</i>，你保护在乎的人和事的样子，帅炸了。`,
    `<i>{{username}}</i>的酒窝（或任何特点）里，是不是藏了整个宇宙的温柔？`,
    `<i>{{username}}</i>的行动力，永远比语言快一步。`,
    `<i>{{username}}</i>的真诚，是他最强大的“武器”。`,
    `<i>{{username}}</i>对待工作的认真，堪称行业标杆。`,
    `<i>{{username}}</i>的背影，都写着“安全感”三个字。`,
    `<i>{{username}}</i>，你是我见过把“深色系”穿得最有灵魂的人。`,
    `<i>{{username}}</i>的胸怀，能纳百川，也能容小事。`,
    `<i>{{username}}</i>的音乐/电影品味，高级又独特。`,
    `<i>{{username}}</i>，你的声音听起来就很值得信赖。`,
    `<i>{{username}}</i>的观察力细微入至，什么都逃不过他的眼睛。`,
    `<i>{{username}}</i>的坚持，是“墨”守初心，一“黑”到底。`,
    `有<i>{{username}}</i>做兄弟，是人生一大幸事。`,
    `<i>{{username}}</i>的慷慨，不在于给予什么，而在于那份心意。`,
    `<i>{{username}}</i>，你专注做事时，整个世界都成了你的背景。`,
    `<i>{{username}}</i>的胜负欲，用在了最该用的地方。`,
    `<i>{{username}}</i>偶尔的调皮，有种强烈的反差魅力。`,
    `<i>{{username}}</i>的承诺，一字千金，说到做到。`,
    `<i>{{username}}</i>的存在，让“男性魅力”有了具体的注解。`,
    `<i>{{username}}</i>的厨艺（或任何技能），竟然也这么出色！`,
    `<i>{{username}}</i>的视野，从不局限于眼前。`,
    `<i>{{username}}</i>，愿你永远如黑曜石般，坚硬、璀璨又自带光芒。`,
    `能成为被<i>{{username}}</i>认可的朋友，我感到很骄傲。`,
    `最后一句：<i>{{username}}</i>，继续闪耀吧，你生来就该如此。`
]

// 迎宾模板
const welcomingGuestsTemplates = [
    `有贵客到！恭请咱们墨云阁的<i>{{username}}</i>老板，前来迎客啦！`,
    `哟！来稀客了！<i>{{username}}</i>，快别忙了，出来接您墨云阁的知音人！`,
    `流水遇知音。老板，<i>{{username}}</i>，您等的客官到了，还请移步墨云阁前厅。`,
    `贵客临门，蓬荜生辉！有请墨云阁当家——<i>{{username}}</i>，亲自接待！`,
    `泼妇！<i>{{username}}</i>！墨云阁来新朋友了，需要您亲自来介绍一下咱们的宝贝！`,
    `客人对咱有兴趣，得请咱们墨云阁最懂行的<i>{{username}}</i>来细说才行！`,
    `开张啦！<i>{{username}}</i>，墨云阁来贵客了，请您这个‘镇店之宝’出来见客咯！`,
    `有雅客至。恭请墨云阁主人——<i>{{username}}</i>，前来迎迓。`,
    `<i>{{username}}</i>！快来看，咱们墨云阁来了一位眼光顶好的客人，非得您来招待不可！`,
    `风送佳客来。<i>{{username}}</i>，您一直等的，懂得墨云阁妙处的人，来了。`,
    `贵客光临！有请咱们墨云阁最美的招牌——<i>{{username}}</i>，亲自接驾！`,
    `老板！您的‘ VIP 识别雷达’响了！<i>{{username}}</i>，墨云阁有贵客到，请您出面啦！`,
    `客人品味非凡，正好欣赏了咱们那件镇店之宝，非得请<i>{{username}}</i>您来聊聊。`,
    `云开见月明，贵客见主人。恭请墨云阁主理人——<i><i>{{username}}</i></i>，亲自为贵客引路讲解。`,
]


// 墨云阁开号机器人用户id
const MYG_OPEN_ACCOUNT_BOT_USER_ID = 7716090156;

// 墨云阁群聊id
// const MYG_GROUP_ID = 2470366329;
const MYG_GROUP_ID = -1002470366329;
const MB_USER_ID = 627156768;
const BDS_USER_ID = 5561262684;

export default class MYGPlugin extends BasePlugin {
    command = 'myg';
    name = '墨云阁专用插件';
    description = '主要用于墨云阁吹喇叭';
    scope = 'both' as PluginScope;

    protected async handlerCommand(message: MessageContext, command: string | null, args: string[]): Promise<void> {
        let content: string
        switch (command) {
            case 'kmb' :
                content = builderMessageContent(`<a href="tg://user?id=${MB_USER_ID}">@愤青小泼妇</a>`, praiseGirlTemplates);
                await message.edit({
                    text: html`${content}`
                });
                break;
            case 'kbds':
                content = builderMessageContent(`<a href="tg://user?id=${BDS_USER_ID}">@不懂事妹妹</a>`, praiseGirlTemplates);
                await message.edit({text: html(content)});
                break;
            case 'kt1':
            case 'kt2':
                let replyTo = await message.getReplyTo();
                if (!replyTo) {
                    await message.edit({text: '你必须回复一条消息才能够进行夸ta'})
                }
                let user = await this.context.client.getUser(replyTo.sender);
                const templates = args[0] === 'kt1' ? praiseBoyTemplates : praiseGirlTemplates;
                const text = builderMessageContent(`<a href="tg://user?id=${user.id}">${user.displayName}</a>`, templates);
                await message.edit({text: html(text)});
                break;
            default:
                content = `<b>🔧当前插件目前只支持墨云阁开号自动吹喇叭以及彩虹屁功能</b><br/>
<b>📋 基础命令：</b><br/>
<code>myg kmb</code> - 夸管理员墨白<br/>
<code>myg kbds</code> - 夸夸不懂事<br/>
<code>myg kt1</code> - 回复一条消息直接夸他<br/>
<code>myg kt2</code> - 回复一条消息直接夸她<br/>
            `
                await message.edit({
                    text: html(content)
                })
                break;
        }
    }

    protected async handleMessage(message: MessageContext): Promise<void> {
        let chatId = this.getChatId(message);
        let userId = this.getUserId(message);

        let content = '';
        let params: CommonSendParams = {}
        // 判断为墨云阁群聊
        // if (chatId === MYG_GROUP_ID || chatId === 3435821057 || 1 === 1) {
        if (chatId === MYG_GROUP_ID) {
            // 判断是否为开号的 Bot 消息
            if (this.isOpenAccount(message)) {
                content = this.builderOpenAccountReplyContent(message);
            }
            // 开号成功
            if (this.isOpenAccountSuccessful(message)) {
                content = this.builderOpenAccountSuccessfulReplyContent(message);
            }
            // 开白名单
            if (this.isOpenWhitelist(message)) {
                content = this.builderOpenWhitelistReplyContent(message);
            }
            // 发电
            if (this.isWelcomingGuests(message)) {
                content = this.builderWelcomingGuestsReplyContent(message);
                params.replyTo = message.id;
            }
            if (content) {
                try {
                    const context = this.context;
                    const client = context.client;
                    await client.sendText(message.chat, html(content), params);
                } catch (e) {
                    console.error('发送消息时发生错误', e);
                }
            }
        }
    }

    /**
     * 开号检测
     * @param message
     */
    private isOpenAccount(message: MessageContext): boolean {
        const userId = this.getUserId(message);
        const text = message?.text.trim() || '';
        return (userId === MYG_OPEN_ACCOUNT_BOT_USER_ID && text.includes('赠予资格。前往bot进行下一步操作'));
        // return message.message.includes('赠予资格。前往bot进行下一步操作')
    }

    /**
     * 开号成功检测
     * @param message
     */
    private isOpenAccountSuccessful(message: MessageContext): boolean {
        const userId = this.getUserId(message);
        const text = message?.text.trim() || '';
        return (userId === MYG_OPEN_ACCOUNT_BOT_USER_ID && text.includes('注册码使用'))
        // return message.message.includes('注册码使用')
    }


    /**
     * 白名单检测
     * @param message
     */
    private isOpenWhitelist(message: MessageContext): boolean {
        const userId = this.getUserId(message);
        let text = message?.text.trim() || '';
        return (userId === MYG_OPEN_ACCOUNT_BOT_USER_ID && text.endsWith('名单.') && text.includes('签出的'));
        // return messageContent.endsWith('名单.') && messageContent.includes('签出的')
    }

    /**
     * 发电检测
     * @param message
     */
    private isWelcomingGuests(message: MessageContext): boolean {
        const text = message?.text.trim() || '';
        const sender = message.sender
        return (sender.type === 'user' && !message.isOutgoing && (text.includes('发电') || text.includes('开号') || text.includes('注册')));
    }

    /**
     * 构建开号回复消息的内容
     * @param message
     */
    private builderOpenAccountReplyContent(message: MessageContext): string {
        try {
            const text = message.text.trim() || '';
            let entities = this.getMessageEntityMentionNameEntities(message);
            let user = entities[1];
            let admin = entities[0];
            const userId = Number(user.userId);
            const username = text.substring(user.offset, user.offset + user.length)
            const adminUsername = text.substring(admin.offset, admin.offset + admin.length)
            return `<a href="tg://user?id=${userId}">${username}</a> 这个逼获得管理员 <i>${adminUsername}</i> 赠予席位资格, 🎺🎺🎺开始奏乐`;
        } catch (e) {
            return '';
        }
    }

    /**
     * 构建开号成功回复消息内容
     * @param message
     */
    private builderOpenAccountSuccessfulReplyContent(message: MessageContext): string {
        const text = message.text.trim() || '';
        const entities = this.getMessageEntityMentionNameEntities(message);
        const entity = entities[0];
        const userId = Number(entity.userId);
        const username = text.substring(entity.offset, entity.offset + entity.length)
        let content = builderMessageContent(`<a href="tg://user?id=${userId}">${username}</a> 这个逼`, mygCongratulatoryTemplates);
        return `${content} 🎺🎺🎺接着奏乐`;
    }

    /**
     * 构建白名单回复消息内容
     * @param message
     */
    private builderOpenWhitelistReplyContent(message: MessageContext): string {
        const text = message.text.trim() || '';
        let entities = this.getMessageEntityMentionNameEntities(message);
        const entity = entities[0];
        const userId = Number(entity.userId);
        const username = text.substring(entity.offset, entity.offset + entity.length);
        // 白名单名称
        const whitelistName = text.substring(text.length - 4, text.length - 1);
        const prefix = whitelistName.substring(0, 1);
        const templates = getOpenWhitelistTemplates(prefix, whitelistName)
        let content = builderMessageContent(`<a href="tg://user?id=${userId}">${username}</a> 这个逼`, templates);
        return `${content} 🎺🎺🎺一起奏乐`;
    }

    /**
     * 构建迎宾回复消息
     * @param message
     */
    private builderWelcomingGuestsReplyContent(message: MessageContext): string {
        return `<a href="tg://user?id=${MB_USER_ID}">@愤青小泼妇</a> 出来接客拉 🎺🎺🎺`;
    }
}


/**
 * 获取开通白名单消息模板
 * @param prefix
 * @param whitelistName
 */
function getOpenWhitelistTemplates(prefix: string, whitelistName: string): string[] {
    const templates = whitelistTemplates[prefix];
    if (!templates) {
        return ['恭喜 <i>{{username}}</i> 获得' + whitelistName];
    }
    return templates;
}

/**
 * 随机获取一条墨云阁账号开通祝贺词，并替换用户名占位符
 * @param username 用户名（必填，确保传递有效非空字符串）
 * @param templates 模板列表
 * @returns 填充了用户名的随机中二祝贺词字符串
 */
function builderMessageContent(username: string, templates: string[]): string {
    // 1. 生成随机索引（核心逻辑不变，避免索引越界）
    const randomIndex = Math.floor(Math.random() * templates.length);

    // 2. 获取对应的模板字符串
    const template = templates[randomIndex];

    // 3. 替换占位符：使用 String.prototype.replace() 匹配 {{username}} 并替换为实际用户名
    // 正则表达式 /{{username}}/g 确保全局替换（若模板中出现多个占位符也能全部替换）
    return template.replace(/{{username}}/g, username);
}
