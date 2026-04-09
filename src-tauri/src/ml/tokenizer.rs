use std::collections::HashMap;
use std::fs;
use std::path::Path;

const CLS_TOKEN: &str = "[CLS]";
const PAD_TOKEN: &str = "[PAD]";
const SEP_TOKEN: &str = "[SEP]";
const UNK_TOKEN: &str = "[UNK]";

#[derive(Debug, Clone)]
pub struct ChineseClipTokenizer {
    vocab: HashMap<String, i64>,
    do_lower_case: bool,
}

#[derive(Debug, Clone)]
pub struct EncodedText {
    pub token_ids: Vec<i64>,
    pub attention_mask: Vec<i64>,
}

impl ChineseClipTokenizer {
    pub fn from_vocab_file(vocab_path: &Path, do_lower_case: bool) -> Result<Self, String> {
        let content = fs::read_to_string(vocab_path)
            .map_err(|e| format!("无法读取 vocab.txt '{}': {}", vocab_path.display(), e))?;

        let mut vocab = HashMap::new();
        for (index, line) in content.lines().enumerate() {
            let token = line.trim();
            if token.is_empty() {
                continue;
            }
            vocab.insert(token.to_string(), index as i64);
        }

        for required_token in [PAD_TOKEN, CLS_TOKEN, SEP_TOKEN, UNK_TOKEN] {
            if !vocab.contains_key(required_token) {
                return Err(format!("vocab.txt 缺少必要 token: {required_token}"));
            }
        }

        Ok(Self {
            vocab,
            do_lower_case,
        })
    }

    pub fn encode(&self, text: &str, context_length: usize) -> Vec<i64> {
        let cls_id = self.token_id(CLS_TOKEN);
        let sep_id = self.token_id(SEP_TOKEN);
        let pad_id = self.token_id(PAD_TOKEN);

        let mut result = vec![pad_id; context_length];
        let mut tokens = Vec::with_capacity(context_length);
        tokens.push(cls_id);
        tokens.extend(
            self.tokenize(text)
                .into_iter()
                .map(|token| self.token_id_or_unk(&token))
                .take(context_length.saturating_sub(2)),
        );
        tokens.push(sep_id);

        for (index, token_id) in tokens.into_iter().enumerate().take(context_length) {
            result[index] = token_id;
        }

        result
    }

    pub fn encode_with_attention_mask(&self, text: &str, context_length: usize) -> EncodedText {
        let pad_id = self.token_id(PAD_TOKEN);
        let token_ids = self.encode(text, context_length);
        let attention_mask = token_ids
            .iter()
            .map(|token_id| if *token_id == pad_id { 0 } else { 1 })
            .collect();

        EncodedText {
            token_ids,
            attention_mask,
        }
    }

    fn tokenize(&self, text: &str) -> Vec<String> {
        let normalized = self.clean_text(text);
        let with_spaced_cjk = self.tokenize_chinese_chars(&normalized);
        let original_tokens = self.whitespace_tokenize(&with_spaced_cjk);

        let mut split_tokens = Vec::new();
        for token in original_tokens {
            let mut current = token;
            if self.do_lower_case {
                current = current.to_lowercase();
                current = self.strip_accents(&current);
            }

            for sub_token in self.run_split_on_punc(&current) {
                split_tokens.extend(self.wordpiece_tokenize(&sub_token));
            }
        }

        split_tokens
    }

    fn token_id(&self, token: &str) -> i64 {
        self.vocab
            .get(token)
            .copied()
            .unwrap_or_else(|| self.vocab[UNK_TOKEN])
    }

    fn token_id_or_unk(&self, token: &str) -> i64 {
        self.vocab
            .get(token)
            .copied()
            .unwrap_or_else(|| self.vocab[UNK_TOKEN])
    }

    fn whitespace_tokenize(&self, text: &str) -> Vec<String> {
        text.split_whitespace().map(str::to_string).collect()
    }

    fn clean_text(&self, text: &str) -> String {
        let mut output = String::with_capacity(text.len());
        for ch in text.chars() {
            let codepoint = ch as u32;
            if codepoint == 0 || codepoint == 0xFFFD || is_control(ch) {
                continue;
            }
            if is_whitespace(ch) {
                output.push(' ');
            } else {
                output.push(ch);
            }
        }
        output
    }

    fn tokenize_chinese_chars(&self, text: &str) -> String {
        let mut output = String::with_capacity(text.len() * 2);
        for ch in text.chars() {
            if is_chinese_char(ch as u32) {
                output.push(' ');
                output.push(ch);
                output.push(' ');
            } else {
                output.push(ch);
            }
        }
        output
    }

    fn strip_accents(&self, text: &str) -> String {
        text.chars()
            .filter(|ch| !matches!(unicode_category(*ch), UnicodeCategory::NonspacingMark))
            .collect()
    }

    fn run_split_on_punc(&self, text: &str) -> Vec<String> {
        let mut output = Vec::new();
        let mut current = String::new();

        for ch in text.chars() {
            if is_punctuation(ch) {
                if !current.is_empty() {
                    output.push(std::mem::take(&mut current));
                }
                output.push(ch.to_string());
            } else {
                current.push(ch);
            }
        }

        if !current.is_empty() {
            output.push(current);
        }

        output
    }

    fn wordpiece_tokenize(&self, token: &str) -> Vec<String> {
        let chars = token.chars().collect::<Vec<_>>();
        if chars.len() > 200 {
            return vec![UNK_TOKEN.to_string()];
        }

        let mut output_tokens = Vec::new();
        let mut start = 0usize;
        let mut is_bad = false;

        while start < chars.len() {
            let mut end = chars.len();
            let mut current_substr = None;

            while start < end {
                let mut piece = chars[start..end].iter().collect::<String>();
                if start > 0 {
                    piece = format!("##{piece}");
                }

                if self.vocab.contains_key(&piece) {
                    current_substr = Some(piece);
                    break;
                }
                end -= 1;
            }

            if let Some(piece) = current_substr {
                output_tokens.push(piece);
                start = end;
            } else {
                is_bad = true;
                break;
            }
        }

        if is_bad {
            vec![UNK_TOKEN.to_string()]
        } else {
            output_tokens
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UnicodeCategory {
    NonspacingMark,
    Other,
}

fn unicode_category(ch: char) -> UnicodeCategory {
    if matches!(ch, '\u{0300}'..='\u{036F}' | '\u{1AB0}'..='\u{1AFF}' | '\u{1DC0}'..='\u{1DFF}' | '\u{20D0}'..='\u{20FF}' | '\u{FE20}'..='\u{FE2F}')
    {
        UnicodeCategory::NonspacingMark
    } else {
        UnicodeCategory::Other
    }
}

fn is_whitespace(ch: char) -> bool {
    ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' || ch.is_whitespace()
}

fn is_control(ch: char) -> bool {
    if matches!(ch, '\t' | '\n' | '\r') {
        return false;
    }

    ch.is_control()
}

fn is_punctuation(ch: char) -> bool {
    let codepoint = ch as u32;
    if (33..=47).contains(&codepoint)
        || (58..=64).contains(&codepoint)
        || (91..=96).contains(&codepoint)
        || (123..=126).contains(&codepoint)
    {
        return true;
    }

    ch.is_ascii_punctuation()
        || matches!(
            ch,
            '。' | '，'
                | '！'
                | '？'
                | '：'
                | '；'
                | '（'
                | '）'
                | '【'
                | '】'
                | '「'
                | '」'
                | '《'
                | '》'
                | '、'
                | '…'
                | '“'
                | '”'
                | '‘'
                | '’'
        )
}

fn is_chinese_char(codepoint: u32) -> bool {
    (0x4E00..=0x9FFF).contains(&codepoint)
        || (0x3400..=0x4DBF).contains(&codepoint)
        || (0x20000..=0x2A6DF).contains(&codepoint)
        || (0x2A700..=0x2B73F).contains(&codepoint)
        || (0x2B740..=0x2B81F).contains(&codepoint)
        || (0x2B820..=0x2CEAF).contains(&codepoint)
        || (0xF900..=0xFAFF).contains(&codepoint)
        || (0x2F800..=0x2FA1F).contains(&codepoint)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizer_encodes_cls_text_sep_with_padding() {
        let vocab_path = std::env::temp_dir().join(format!(
            "shiguang-tokenizer-vocab-{}-{}.txt",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        std::fs::write(
            &vocab_path,
            "[PAD]\n[UNK]\n[CLS]\n[SEP]\n你\n好\nworld\n##s\n!\n",
        )
        .unwrap();

        let tokenizer = ChineseClipTokenizer::from_vocab_file(&vocab_path, true).unwrap();
        let ids = tokenizer.encode("你好 worlds!", 8);
        let _ = std::fs::remove_file(&vocab_path);

        assert_eq!(ids[..6], [2, 4, 5, 6, 7, 8]);
        assert_eq!(ids[6], 3);
        assert_eq!(ids[7], 0);
    }

    #[test]
    fn tokenizer_builds_attention_mask_from_padding() {
        let vocab_path = std::env::temp_dir().join(format!(
            "shiguang-tokenizer-mask-{}-{}.txt",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        std::fs::write(&vocab_path, "[PAD]\n[UNK]\n[CLS]\n[SEP]\n你\n").unwrap();

        let tokenizer = ChineseClipTokenizer::from_vocab_file(&vocab_path, true).unwrap();
        let encoded = tokenizer.encode_with_attention_mask("你", 6);
        let _ = std::fs::remove_file(&vocab_path);

        assert_eq!(encoded.token_ids, vec![2, 4, 3, 0, 0, 0]);
        assert_eq!(encoded.attention_mask, vec![1, 1, 1, 0, 0, 0]);
    }
}
