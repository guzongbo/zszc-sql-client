use crate::error::PluginError;
use crate::models::{
    GeneratePassphraseParams, GeneratePasswordParams, GenerateUsernameParams, GeneratedTextResponse,
    RandomProfileResponse, UsernameStyle,
};
use chrono::NaiveDate;
use rand::{Rng, seq::SliceRandom};

const USCC_BASE: &[u8; 31] = b"0123456789ABCDEFGHJKLMNPQRTUWXY";
const USCC_WEIGHTS: [usize; 17] = [
    1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28,
];
const ID_WEIGHTS: [usize; 17] = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK_CODES: [char; 11] = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

const ADMIN_CODES: &[&str] = &[
    "110000", "120000", "130000", "310000", "320000", "330000", "340000", "350000", "360000",
    "370000", "410000", "420000", "430000", "440100", "440300", "450000", "460000", "500000",
    "510100", "520000", "530000", "610000", "620000", "630000", "640000", "650000",
];

const MOBILE_PREFIXES: &[&str] = &[
    "130", "131", "132", "133", "135", "136", "137", "138", "139", "145", "147", "149", "150",
    "151", "152", "153", "155", "156", "157", "158", "159", "166", "171", "172", "173", "175",
    "176", "177", "178", "180", "181", "182", "183", "184", "185", "186", "187", "188", "189",
    "190", "191", "193", "195", "196", "197", "198", "199",
];

const EMAIL_PREFIXES: &[&str] = &[
    "user", "mock", "sample", "data", "test", "id", "blue", "mint", "lake", "snow",
];
const EMAIL_DOMAINS: &[&str] = &[
    "example.com",
    "testmail.cn",
    "mail.com",
    "qq.com",
    "163.com",
    "outlook.com",
];
const BANK_BINS: &[&str] = &["622202", "622848", "621700", "622262", "622575", "623058", "622700"];
const STREETS: &[&str] = &["人民路", "中山路", "解放路", "建设路", "学院路", "科技路", "滨江路"];
const SURNAMES: &[&str] = &[
    "赵", "钱", "孙", "李", "周", "吴", "郑", "王", "冯", "陈", "褚", "卫", "蒋", "沈", "韩",
    "杨", "朱", "秦", "尤", "许", "何", "吕", "施", "张", "孔", "曹", "严", "华", "金", "魏",
    "陶", "姜", "谢", "邹", "喻", "柏", "水", "窦", "章", "云", "苏", "潘", "葛", "范", "彭",
    "郎", "鲁", "韦", "昌", "马", "苗", "凤", "花", "方", "俞", "任", "袁", "柳", "酆", "鲍",
    "史", "唐", "费", "廉", "岑", "薛", "雷", "贺", "倪", "汤", "滕", "殷", "罗", "毕", "郝",
    "邬", "安", "常", "乐", "于", "时", "傅", "皮", "卞", "齐", "康", "伍", "余", "元", "卜",
    "顾", "孟", "平", "黄", "和", "穆", "萧", "尹",
];
const GIVEN_NAME_CHARS: &[&str] = &[
    "安", "柏", "晨", "宸", "川", "朵", "恩", "凡", "菲", "涵", "航", "皓", "泓", "嘉", "瑾",
    "景", "可", "朗", "乐", "琳", "霖", "铭", "沐", "楠", "宁", "诺", "琪", "然", "瑞", "杉",
    "诗", "姝", "思", "彤", "桐", "维", "熙", "夏", "潇", "晓", "昕", "心", "星", "轩", "雅",
    "妍", "依", "奕", "毅", "逸", "盈", "宇", "羽", "玥", "悦", "昀", "泽", "知", "芷", "子",
];
const PASSPHRASE_WORDS: &[&str] = &[
    "amber", "apricot", "aurora", "bamboo", "cactus", "cedar", "citrus", "clover", "cosmos",
    "delta", "drizzle", "ember", "forest", "glacier", "harbor", "hazel", "island", "jungle",
    "lagoon", "lantern", "meadow", "meteor", "mist", "nectar", "orbit", "petal", "pine", "river",
    "sprout", "stream", "sunset", "tidal", "valley", "velvet", "willow", "zephyr",
];
const USERNAME_ADJECTIVES: &[&str] = &[
    "brisk", "calm", "clear", "crisp", "eager", "ember", "fresh", "gentle", "glossy", "lucky",
    "mellow", "noble", "rapid", "silver", "steady", "sunny", "tidy", "vivid",
];
const USERNAME_NOUNS: &[&str] = &[
    "atlas", "brook", "cloud", "drift", "field", "harbor", "leaf", "meadow", "nova", "otter",
    "pixel", "ridge", "signal", "spark", "stream", "trail", "vista", "whale",
];
const USERNAME_PINYIN: &[&str] = &[
    "an", "bo", "chen", "fei", "hao", "jia", "lin", "ming", "ning", "qing", "rui", "shan", "ting",
    "wen", "xin", "yang", "yu", "zhe",
];
const USERNAME_TECH_WORDS: &[&str] = &[
    "byte", "cache", "cursor", "delta", "index", "logic", "matrix", "node", "query", "schema",
    "script", "sql", "table", "token", "vector",
];
const SYMBOLS: &str = "!@#$%^&*";

#[derive(Clone)]
struct Region {
    province: &'static str,
    city: &'static str,
    districts: &'static [&'static str],
}

static REGIONS: &[Region] = &[
    Region {
        province: "北京市",
        city: "北京市",
        districts: &["朝阳区", "海淀区", "东城区", "西城区", "丰台区"],
    },
    Region {
        province: "上海市",
        city: "上海市",
        districts: &["浦东新区", "黄浦区", "徐汇区", "静安区", "长宁区"],
    },
    Region {
        province: "广东省",
        city: "广州市",
        districts: &["天河区", "越秀区", "海珠区", "白云区", "番禺区"],
    },
    Region {
        province: "四川省",
        city: "成都市",
        districts: &["武侯区", "锦江区", "青羊区", "金牛区", "高新区"],
    },
    Region {
        province: "浙江省",
        city: "杭州市",
        districts: &["西湖区", "上城区", "拱墅区", "滨江区", "余杭区"],
    },
];

pub fn generate_random_profile() -> RandomProfileResponse {
    let mut rng = rand::thread_rng();

    RandomProfileResponse {
        name: random_name(&mut rng),
        uscc: random_uscc(&mut rng),
        id_card: random_id_card(&mut rng),
        bank_card: random_bank_card(&mut rng),
        mobile: random_mobile(&mut rng),
        email: random_email(&mut rng),
        address: random_address(&mut rng),
    }
}

pub fn generate_password(
    params: GeneratePasswordParams,
) -> Result<GeneratedTextResponse, PluginError> {
    validate_password_params(&params)?;

    let mut rng = rand::thread_rng();
    let uppercase = password_charset("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "IO", params.avoid_ambiguous);
    let lowercase = password_charset("abcdefghijklmnopqrstuvwxyz", "l", params.avoid_ambiguous);
    let numbers = password_charset("0123456789", "01", params.avoid_ambiguous);
    let symbols = SYMBOLS.chars().collect::<Vec<_>>();

    let mut segments: Vec<Vec<char>> = Vec::new();
    let mut required_chars: Vec<char> = Vec::new();

    if params.include_uppercase {
        segments.push(uppercase.clone());
        required_chars.push(*uppercase.choose(&mut rng).unwrap());
    }

    if params.include_lowercase {
        segments.push(lowercase.clone());
        required_chars.push(*lowercase.choose(&mut rng).unwrap());
    }

    if params.include_numbers {
        segments.push(numbers.clone());
        for _ in 0..params.min_numbers {
            required_chars.push(*numbers.choose(&mut rng).unwrap());
        }
    }

    if params.include_symbols {
        segments.push(symbols.clone());
        for _ in 0..params.min_symbols {
            required_chars.push(*symbols.choose(&mut rng).unwrap());
        }
    }

    let pool = segments.into_iter().flatten().collect::<Vec<_>>();

    // 先满足必选字符，再用总字符池补齐余量，避免选项开启后却完全未命中。
    while required_chars.len() < params.length {
        required_chars.push(*pool.choose(&mut rng).unwrap());
    }
    required_chars.shuffle(&mut rng);

    let value = required_chars.iter().collect::<String>();
    let charset_size = pool.len();
    let entropy_bits = (params.length as f64) * (charset_size as f64).log2();

    Ok(GeneratedTextResponse {
        value,
        strength_label: Some(strength_label(entropy_bits)),
        helper_text: Some(format!(
            "长度 {} · 字符池 {} 类",
            params.length, charset_size
        )),
    })
}

pub fn generate_passphrase(
    params: GeneratePassphraseParams,
) -> Result<GeneratedTextResponse, PluginError> {
    if !(3..=8).contains(&params.word_count) {
        return Err(PluginError::InvalidInput(
            "密码短语单词数必须在 3 到 8 之间".to_string(),
        ));
    }

    let separator = normalize_separator(&params.separator)?;
    let mut rng = rand::thread_rng();
    let mut words = Vec::with_capacity(params.word_count);

    for _ in 0..params.word_count {
        let word = PASSPHRASE_WORDS.choose(&mut rng).unwrap().to_string();
        words.push(if params.capitalize_words {
            capitalize_ascii(word)
        } else {
            word
        });
    }

    let mut value = words.join(&separator);
    if params.append_number {
        let suffix = rng.gen_range(10..=99);
        if separator.is_empty() {
            value.push_str(&suffix.to_string());
        } else {
            value.push_str(&separator);
            value.push_str(&suffix.to_string());
        }
    }

    let entropy_bits = (params.word_count as f64) * (PASSPHRASE_WORDS.len() as f64).log2()
        + if params.append_number {
            (90_f64).log2()
        } else {
            0.0
        };

    Ok(GeneratedTextResponse {
        value,
        strength_label: Some(strength_label(entropy_bits)),
        helper_text: Some(format!(
            "{} 个单词{}",
            params.word_count,
            if params.append_number { " · 追加数字" } else { "" }
        )),
    })
}

pub fn generate_username(
    params: GenerateUsernameParams,
) -> Result<GeneratedTextResponse, PluginError> {
    if !(6..=24).contains(&params.length) {
        return Err(PluginError::InvalidInput(
            "用户名长度必须在 6 到 24 之间".to_string(),
        ));
    }

    let separator = normalize_separator(&params.separator)?;
    let mut rng = rand::thread_rng();

    let parts = match params.style {
        UsernameStyle::WordCombo => vec![
            USERNAME_ADJECTIVES.choose(&mut rng).unwrap().to_string(),
            USERNAME_NOUNS.choose(&mut rng).unwrap().to_string(),
        ],
        UsernameStyle::PinyinStyle => vec![
            USERNAME_PINYIN.choose(&mut rng).unwrap().to_string(),
            USERNAME_PINYIN.choose(&mut rng).unwrap().to_string(),
            USERNAME_PINYIN.choose(&mut rng).unwrap().to_string(),
        ],
        UsernameStyle::TechStyle => vec![
            USERNAME_TECH_WORDS.choose(&mut rng).unwrap().to_string(),
            USERNAME_NOUNS.choose(&mut rng).unwrap().to_string(),
        ],
    };

    let mut value = parts.join(&separator).to_lowercase();
    if params.append_number {
        value.push_str(&rng.gen_range(10..=99).to_string());
    }

    value = normalize_username(value, params.length, params.avoid_ambiguous, &mut rng);

    Ok(GeneratedTextResponse {
        value,
        strength_label: None,
        helper_text: Some(username_style_label(params.style).to_string()),
    })
}

fn validate_password_params(params: &GeneratePasswordParams) -> Result<(), PluginError> {
    if !(5..=128).contains(&params.length) {
        return Err(PluginError::InvalidInput(
            "密码长度必须在 5 到 128 之间".to_string(),
        ));
    }

    if !params.include_uppercase
        && !params.include_lowercase
        && !params.include_numbers
        && !params.include_symbols
    {
        return Err(PluginError::InvalidInput(
            "至少要启用一种字符类型".to_string(),
        ));
    }

    if !params.include_numbers && params.min_numbers > 0 {
        return Err(PluginError::InvalidInput(
            "未启用数字时，数字最少个数必须为 0".to_string(),
        ));
    }

    if !params.include_symbols && params.min_symbols > 0 {
        return Err(PluginError::InvalidInput(
            "未启用符号时，符号最少个数必须为 0".to_string(),
        ));
    }

    let required = usize::from(params.include_uppercase)
        + usize::from(params.include_lowercase)
        + params.min_numbers
        + params.min_symbols;

    if required > params.length {
        return Err(PluginError::InvalidInput(
            "最少字符要求之和不能超过总长度".to_string(),
        ));
    }

    Ok(())
}

fn random_name(rng: &mut impl Rng) -> String {
    let surname = SURNAMES.choose(rng).unwrap();
    let given_first = GIVEN_NAME_CHARS.choose(rng).unwrap();
    let given_second = GIVEN_NAME_CHARS.choose(rng).unwrap();

    if rng.gen_bool(0.35) {
        format!("{surname}{given_first}")
    } else {
        format!("{surname}{given_first}{given_second}")
    }
}

fn random_uscc(rng: &mut impl Rng) -> String {
    let first_options: &[char] = &['1', '5', '9', 'A', 'Y'];
    let second_options: &[char] = &['1', '2', '3', '9', 'A', 'Y'];
    let admin = ADMIN_CODES.choose(rng).unwrap();
    let mut code = String::with_capacity(18);

    code.push(*first_options.choose(rng).unwrap());
    code.push(*second_options.choose(rng).unwrap());
    code.push_str(admin);

    for _ in 0..9 {
        code.push(random_uscc_char(rng));
    }

    code.push(uscc_check_char(&code));
    code
}

fn random_id_card(rng: &mut impl Rng) -> String {
    let admin = ADMIN_CODES.choose(rng).unwrap();
    let birth = random_birthdate(rng);
    let seq: u16 = rng.gen_range(0..=999);
    let body = format!("{admin}{birth}{seq:03}");

    format!("{body}{}", id_check_char(&body))
}

fn random_bank_card(rng: &mut impl Rng) -> String {
    let bin = BANK_BINS.choose(rng).unwrap();
    let length = if rng.gen_bool(0.6) { 16 } else { 19 };
    let mut number = String::with_capacity(length);
    number.push_str(bin);

    let body_len = length - 1;
    for _ in bin.len()..body_len {
        number.push(char::from_digit(rng.gen_range(0..=9), 10).unwrap());
    }

    number.push(luhn_check_digit(&number));
    number
}

fn random_mobile(rng: &mut impl Rng) -> String {
    let prefix = MOBILE_PREFIXES.choose(rng).unwrap();
    let mut number = String::with_capacity(11);
    number.push_str(prefix);
    for _ in 0..8 {
        number.push(char::from_digit(rng.gen_range(0..=9), 10).unwrap());
    }
    number
}

fn random_email(rng: &mut impl Rng) -> String {
    let prefix = EMAIL_PREFIXES.choose(rng).unwrap();
    let suffix: u16 = rng.gen_range(1000..=9999);
    let domain = EMAIL_DOMAINS.choose(rng).unwrap();

    format!("{prefix}{suffix}@{domain}")
}

fn random_address(rng: &mut impl Rng) -> String {
    let region = REGIONS.choose(rng).unwrap();
    let district = region.districts.choose(rng).unwrap();
    let street = STREETS.choose(rng).unwrap();
    let number: u16 = rng.gen_range(1..=999);

    format!(
        "{}{}{}{}{}号",
        region.province, region.city, district, street, number
    )
}

fn random_birthdate(rng: &mut impl Rng) -> String {
    loop {
        let year = rng.gen_range(1960..=2008);
        let month = rng.gen_range(1..=12);
        let day = rng.gen_range(1..=31);

        if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
            return date.format("%Y%m%d").to_string();
        }
    }
}

fn random_uscc_char(rng: &mut impl Rng) -> char {
    let idx = rng.gen_range(0..USCC_BASE.len());
    USCC_BASE[idx] as char
}

fn uscc_check_char(body: &str) -> char {
    // 统一社会信用代码校验：基于 31 进制加权求和得到最后一位校验码。
    let mut sum = 0usize;
    for (index, ch) in body.chars().enumerate() {
        let value = uscc_value(ch);
        sum += value * USCC_WEIGHTS[index];
    }

    let modulo = sum % 31;
    let check = (31 - modulo) % 31;
    USCC_BASE[check] as char
}

fn uscc_value(ch: char) -> usize {
    USCC_BASE
        .iter()
        .position(|candidate| *candidate as char == ch)
        .unwrap_or(0)
}

fn id_check_char(body: &str) -> char {
    // 身份证校验：按国家标准对前 17 位做加权求和映射校验码。
    let mut sum = 0usize;
    for (index, ch) in body.chars().enumerate() {
        let digit = ch.to_digit(10).unwrap() as usize;
        sum += digit * ID_WEIGHTS[index];
    }

    ID_CHECK_CODES[sum % 11]
}

fn luhn_check_digit(body: &str) -> char {
    // 银行卡校验：Luhn 算法从右向左倍增并折算。
    let mut sum = 0u32;
    let mut double = true;

    for ch in body.chars().rev() {
        let mut digit = ch.to_digit(10).unwrap();
        if double {
            digit *= 2;
            if digit > 9 {
                digit -= 9;
            }
        }

        sum += digit;
        double = !double;
    }

    let check = (10 - (sum % 10)) % 10;
    char::from_digit(check, 10).unwrap()
}

fn password_charset(all_chars: &str, excluded: &str, avoid_ambiguous: bool) -> Vec<char> {
    all_chars
        .chars()
        .filter(|ch| !avoid_ambiguous || !excluded.contains(*ch))
        .collect()
}

fn normalize_separator(raw: &str) -> Result<String, PluginError> {
    match raw {
        "" | "-" | "_" | "." | " " => Ok(raw.to_string()),
        _ => Err(PluginError::InvalidInput(
            "分隔符仅支持空字符串、-、_、. 或空格".to_string(),
        )),
    }
}

fn normalize_username(
    mut value: String,
    length: usize,
    avoid_ambiguous: bool,
    rng: &mut impl Rng,
) -> String {
    let letters = if avoid_ambiguous {
        "abcdefghjkmnpqrstuvwxyz23456789"
    } else {
        "abcdefghijklmnopqrstuvwxyz0123456789"
    };
    let letter_pool = letters.chars().collect::<Vec<_>>();

    if !value.chars().next().is_some_and(|ch| ch.is_ascii_alphabetic()) {
        value.insert(0, 'u');
    }

    while value.len() < length {
        value.push(*letter_pool.choose(rng).unwrap());
    }

    value.chars().take(length).collect()
}

fn capitalize_ascii(value: String) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
        None => value,
    }
}

fn strength_label(entropy_bits: f64) -> String {
    if entropy_bits >= 80.0 {
        "很强".to_string()
    } else if entropy_bits >= 60.0 {
        "较强".to_string()
    } else if entropy_bits >= 40.0 {
        "中等".to_string()
    } else {
        "较弱".to_string()
    }
}

fn username_style_label(style: UsernameStyle) -> &'static str {
    match style {
        UsernameStyle::WordCombo => "英文组合",
        UsernameStyle::PinyinStyle => "拼音风格",
        UsernameStyle::TechStyle => "技术风格",
    }
}
