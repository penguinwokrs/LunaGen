import argparse
import sys
import time
import os
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
from ai_generator import get_message_generator

# .env ファイルから環境変数を読み込む
load_dotenv()

# ==========================================
# 設定 / Configuration
# ==========================================
LOGIN_URL = "https://luna-matching.com/auth"
MY_PROFILE_URL = "https://luna-matching.com/profile"

# 認証情報 (.env から読み込み)
DEFAULT_EMAIL = os.getenv("LUNA_EMAIL")
DEFAULT_PASSWORD = os.getenv("LUNA_PASSWORD")

if not DEFAULT_EMAIL or not DEFAULT_PASSWORD:
    print("[!] エラー: LUNA_EMAIL または LUNA_PASSWORD が .env ファイルに設定されていません。")
    sys.exit(1)

PROMPT_TEMPLATE = """
あなたはマッチングサイトの人気ユーザーです。
以下の「自分のプロフィール」と「相手のプロフィール」を元に、相手が「この人は私のことを分かってくれている」「話してみたい」と感じ、思わず「いいね」や返信をしたくなるような魅力的な初回メッセージを作成してください。

# 成功のポイント（思わず返信したくなる要素）
1. **「あなただけ」という特別感**: プロフィールの具体的な記述（具体的な趣味、性格、独特な価値観など）を引用し、「まさにそこに惹かれました」と伝える。
2. **感情の共有**: 共通点に対して事実だけでなく、「それが好きなんて最高ですね！」「気が合いそうで嬉しいです」といったポジティブな感情を添える。
3. **安心感と包容力**: 誠実さを伝えつつ、相手の嗜好（M気質や躾けられたい願望など）を「受け止められる」「叶えられる」という頼りがいやS気質をさりげなく匂わせる。
4. **返信のしやすさ**: 相手がパッと答えられる、または語りたくなるような楽しい質問で締めくくる。

# 制約事項
- 最初の文章は必ず「[相手の名前]さん、はじめまして！」のように、相手の名前と挨拶から始めること。
- 文字数は、句読点、記号、カッコ、空白、改行などすべてを含めて合計200文字以内（厳守）。
- 丁寧だが、堅苦しすぎない親しみやすいトーン（絵文字や！を適度に使って明るく）。
- テンプレート感を出さない。自分の言葉で語りかけるように。
- メッセージ本文のみを出力すること。

# 自分のプロフィール
{my_info_clean}

# 相手のプロフィール
{target_info_clean}
"""

# ==========================================
# ヘルパー関数 / Helper Functions
# ==========================================

def login(page, email, password):
    """
    サイトにログインします。
    """
    print(f"[*] {LOGIN_URL} にアクセス中...")
    page.goto(LOGIN_URL)
    
    # ページ読み込み待機 (SPAのためネットワークアイドルを待つのが安全)
    page.wait_for_load_state("networkidle")
    
    print("[*] ログインフォームを探しています...")
    
    try:
        # メールアドレス入力
        # 複数のセレクタパターンを試行
        email_input = None
        for selector in ["input[type='email']", "input[name='email']", "input[placeholder*='メール']", "input[placeholder*='Email']"]:
            if page.is_visible(selector):
                email_input = page.locator(selector).first
                break
        
        if not email_input:
            print("[!] メールアドレス入力欄が見つかりません。ページのスクリーンショットを保存します (login_error.png)。")
            page.screenshot(path="login_error.png")
            sys.exit(1)

        email_input.fill(email)
        print("[*] メールアドレスを入力しました。")

        # パスワード入力
        password_input = page.locator("input[type='password']").first
        password_input.fill(password)
        print("[*] パスワードを入力しました。")

        # ログインボタン押下
        # "ログイン" というテキストを含むボタンを探す、あるいは type='submit'
        submit_btn = page.get_by_role("button", name="ログイン")
        if not submit_btn.is_visible():
             submit_btn = page.locator("button[type='submit']")
        
        if submit_btn.is_visible():
            submit_btn.click()
            print("[*] ログインボタンをクリックしました。")
        else:
            # エンターキーで送信を試みる
            password_input.press("Enter")
            print("[*] Enterキーで送信しました。")

        # ログイン完了待機 (URLが変わるか、特定の要素が表示されるまで)
        # ここではとりあえず5秒待機 (本来は特定の要素を待つべき)
        page.wait_for_timeout(5000)
        
        # ログイン成功判定 (URLチェックなど)
        if "auth" in page.url:
            print("[?] まだログインページにいる可能性があります。処理を続行しますが失敗するかもしれません。")
        else:
            print(f"[*] ログイン成功と思われるURL: {page.url}")

    except Exception as e:
        print(f"[!] ログイン中にエラーが発生しました: {e}")
        page.screenshot(path="login_exception.png")
        raise e

def extract_text_from_page(page, url):
    """
    指定されたURLのテキスト情報を抽出します。
    """
    print(f"[*] {url} から情報を取得中...")
    page.goto(url)
    page.wait_for_load_state("networkidle")
    
    # ページの主要なテキストを取得
    # 特定のクラス (例: .profile-body, .introduction) があればそこを狙う
    # ノイズを減らすため main タグを優先
    if page.locator("main").is_visible():
        content = page.locator("main").inner_text()
    else:
        content = page.locator("body").inner_text()
    
    # 簡単なクリーニング
    lines = [line.strip() for line in content.split('\n') if line.strip()]
    return "\n".join(lines)

def generate_message_with_persona(my_profile_text, target_profile_text):
    """
    AIを使用して、自身のプロフィールと相手のプロフィールを元に共感を呼ぶメッセージを生成します。
    """
    print("[*] AIを使用してメッセージを生成中...")
    
    # セーフティフィルター対策として、極端な単語をマイルドな表現に置換
    def clean_text(text):
        replacements = {
            # "アナル": "部位",
            # "浣腸": "行為",
            # "首絞め": "ハードな行為",
            # "ビンタ": "刺激",
            # "性癖": "好み",
            # "性対象": "恋愛対象",
            # "羞恥": "恥ずかしい体験"
        }
        for old, new in replacements.items():
            text = text.replace(old, new)
        return text

    my_info_clean = clean_text(my_profile_text)
    target_info_clean = clean_text(target_profile_text)

    generator = get_message_generator()
    generated_text = generator.generate(my_info_clean, target_info_clean, PROMPT_TEMPLATE)

    if generated_text:
        print(f"[*] 生成成功: {generated_text[:30]}...")
        return generated_text
    else:
        print("[!] メッセージ生成に失敗しました。テンプレートを使用します。")
        return f"""
はじめまして！プロフィールを拝見して連絡しました。

私も{target_profile_text[:10]}... (相手の趣味など) に興味があります！
もしよろしければお話ししませんか？

(※このメッセージは自動生成されたドラフトです。送信前に内容を確認してください。)
"""

def send_message(page, target_url, message):
    """
    相手のプロフィールページからメッセージを送信します。
    ユーザー指定フロー:
    プロフィール -> いいね -> (モーダル)メッセージ付きいいね -> テキストエリア入力 -> いいね -> 送信
    """
    print(f"[*] {target_url} に移動中...")
    page.goto(target_url)
    page.wait_for_load_state("networkidle")
    
    print("[*] メッセージ送信フローを開始します...")
    
    try:
        # 1. プロフィールの「いいね」ボタンをクリック
        # フッターなどにある「いいね」ボタンを探す
        print("[*] 1. プロフィールの「いいね」ボタンを探しています...")
        
        # 複数のセレクタで試行
        initial_like_btn = None
        
        # パターンA: テキスト「いいね」を含むボタン (ただし「メッセージ付き」などは除外したいが、まずは広く探す)
        # .btn-skip は page_source.html で確認されたいいねボタンのクラス
        candidates = [
            page.locator("button.btn-skip").first,
            page.locator("button").filter(has_text="いいね").first
        ]
        
        for btn in candidates:
            if btn.is_visible():
                initial_like_btn = btn
                break
        
        if not initial_like_btn:
            print("[!] 最初の「いいね」ボタンが見つかりません。")
            page.screenshot(path="step1_like_not_found.png")
            return

        print("[*] 1. 「いいね」ボタンをクリックします。")
        initial_like_btn.click()
        page.wait_for_timeout(1500) # モーダル表示待機

        # 2. モーダル内の「メッセージ付きいいね」を選択
        print("[*] 2. モーダル内の「メッセージ付きいいね」ボタンを探しています...")
        
        # モーダル内に出るはず
        # ユーザー情報により、クラス名 "send-good-with-message" を優先
        # ソースコード解析により、これはラッパーdivの可能性があるため、内部のbuttonも探す
        msg_like_btn = page.locator(".send-good-with-message button").first
        
        if not msg_like_btn.is_visible():
             msg_like_btn = page.locator(".send-good-with-message").first

        if not msg_like_btn.is_visible():
             print("[?] クラス名で見つからないため、テキストで探します...")
             msg_like_btn = page.locator("button").filter(has_text="メッセージ付きいいね").first
        
        if not msg_like_btn.is_visible():
             # さらに別の表記ゆれ対応
             msg_like_btn = page.locator("button").filter(has_text="メッセージ付き").first

        if not msg_like_btn.is_visible():
            print("[!] モーダル内の「メッセージ付きいいね」ボタンが見つかりません。")
            page.screenshot(path="step2_modal_msg_btn_not_found.png")
            return

        print("[*] 2. 「メッセージ付きいいね」ボタンをクリックします。")
        msg_like_btn.click()
        page.wait_for_timeout(1000) # テキストエリア表示待機

        # 3. テキストエリアにメッセージを入力
        print("[*] 3. テキストエリアを探しています...")
        textarea = page.locator("textarea").first
        
        if not textarea.is_visible():
            print("[!] テキストエリアが見つかりません。")
            page.screenshot(path="step3_textarea_not_found.png")
            return
        
        print("[*] 3. テキストエリアにメッセージを入力します。")
        textarea.fill(message)
        page.wait_for_timeout(500)

        # 4. 「いいね」をクリック (メッセージ入力後の確定アクション)
        print("[*] 4. 入力後の「いいね」ボタンを探しています...")
        
        # テキストエリア入力後に押すべきボタン。
        # 文脈的に「いいね」というボタンがあるとのこと。
        confirm_like_btn = page.locator("button").filter(has_text="いいね").last
        
        # もしかすると「送信」ボタンがすぐ出るかもしれないので、両方チェックする
        final_send_btn = page.locator("button").filter(has_text="送信").first
        
        if confirm_like_btn.is_visible() and not final_send_btn.is_visible():
             print("[*] 4. 「いいね」ボタンをクリックします（確認画面への遷移などを想定）。")
             confirm_like_btn.click()
             page.wait_for_timeout(1000)
        elif final_send_btn.is_visible():
             print("[*] 4. 「いいね」ボタンの代わりに「送信」ボタンが既に見えています。ステップ4をスキップします。")
        else:
             print("[?] ステップ4の「いいね」ボタンが見つかりません。処理を続行します。")

        # 5. 「送信」をクリック
        print("[*] 5. 最終的な「送信」ボタンを探しています...")
        final_send_btn = page.locator("button").filter(has_text="送信").first
        
        if final_send_btn.is_visible():
            print(f"[*] 5. 「送信」ボタンが見つかりました。送信準備完了。")
            # final_send_btn.click() # 安全のためコメントアウト
            print("[!] 安全のため、自動送信クリックはコメントアウトされています。")
            page.screenshot(path="ready_to_send_final.png")
        else:
            print("[!] 最後の「送信」ボタンが見つかりませんでした。")
            page.screenshot(path="step5_send_not_found.png")

    except Exception as e:
        print(f"[!] エラーが発生しました: {e}")
        page.screenshot(path="error_flow.png")

# ==========================================
# メイン処理 / Main Execution
# ==========================================

def main():
    parser = argparse.ArgumentParser(description="Luna Matching Auto Message Bot")
    parser.add_argument("target_url", help="メッセージ送信対象のプロフィールURL (例: https://luna-matching.com/user/show/140135)")
    args = parser.parse_args()

    with sync_playwright() as p:
        # ブラウザ起動 (headless=False にすると動作が見えます)
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            **p.devices["Pixel 7"]
        )
        page = context.new_page()

        try:
            # 1. ログイン
            login(page, DEFAULT_EMAIL, DEFAULT_PASSWORD)
            
            # 2. 自身のプロフィール取得 (ペルソナ作成用)
            my_info = extract_text_from_page(page, MY_PROFILE_URL)
            print(f"[*] 自身のプロフィール情報を取得しました ({len(my_info)} 文字)")
            
            # 3. 相手のプロフィール取得
            target_info = extract_text_from_page(page, args.target_url)
            print(f"[*] 相手のプロフィール情報を取得しました ({len(target_info)} 文字)")
            
            # 4. メッセージ生成
            message = generate_message_with_persona(my_info, target_info)
            print("-" * 40)
            print("生成されたメッセージ:\n")
            print(message)
            print("-" * 40)
            
            # 5. メッセージ送信 (スクリプト内の安全装置を解除する必要あり)
            send_message(page, args.target_url, message)

        except Exception as e:
            print(f"[ERROR] 予期せぬエラー: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    main()
