# セキュリティ移行報告書

作成日: 2026-09-02 / 更新日: 2026-09-03

2026-09-03の追加依頼で、注文を印刷後に消去する当初仕様から、認証済みスタッフ間で注文を保存・同期する仕様に変更しました。以下の初回移行記録と区別し、現在の保存場所は第3節を参照してください。

## 1. 修正前の調査結果

### Git追跡対象で確認した非公開・要分離データ

| 種別 | 対象 | 調査結果 |
| --- | --- | --- |
| CSV | `product_master.csv` | 商品3,861件、商品名、卸価格、有効状態 |
| Excel | `outputs/.../商品マスター最新版_2026-08-01.xlsx` | 商品マスター、卸価格、旧価格・新価格の変更履歴 |
| 画像 | `mobile-production-test.png` | 商品名と価格が見える画面画像 |
| HTML | `exhibition_order_production_preview.html` | 商品・スタッフ・接続設定を埋め込んだ単一HTML |
| JavaScript | `online-config.js` | Supabase URL、公開Publishable Key、商品CSV参照、スタッフ・帳合先候補 |
| localStorage | 旧アプリ | 注文全体、顧客情報、商品、数量、セッション、連番 |
| Supabase | 旧アプリ | 注文22件、改訂2件、活動ログ56件、注文バッチ関連テーブル、非公開名刺Storage |

JSONは追跡対象にありませんでした。実顧客レコードのハードコードは見つかりませんでした。テスト用の架空値は一般化しました。

### 秘密鍵の調査

- `service_role`、Supabase Secret Key、固定パスワード、JWT署名秘密は現行ファイルと確認できたGit履歴から見つかりませんでした。
- 見つかったSupabaseキーは公開利用を前提とするPublishable Keyです。
- Publishable KeyはRLSが正しければ公開されても秘密漏えいには当たりません。今回の調査結果だけを理由に再発行する必要はありません。
- 将来、`service_role`、Secret Key、実パスワードが履歴で見つかった場合は、履歴除去より先に該当キーを失効・再発行してください。

## 2. 実施した移行

以下は2026-09-02の初回移行記録です。注文消去・セッション保存方式は、後述の2026-09-03の変更に置き換わっています。

### Supabase

- `public.products` を作成
- `public.exhibition_accounts` を作成
- 商品3,861件を移行（有効3,859件、価格未定2件）
- 帳合先8件を移行
- 両テーブルでRLSを有効化
- `anon` の全権限を取消
- `authenticated` はSELECTだけ付与
- RLSで `exhibition_staff.user_id = auth.uid()` かつ `active = true` を要求
- 有効スタッフは3,861件を取得、非スタッフ認証ユーザーは0件、匿名SELECT権限なしを検証
- 有効スタッフ4アカウントのパスワードをAuth側で共通化（値はGitHub・設定ファイルへ保存しない）
- パスワード変更時に更新トークン9件を失効し、既存セッション5件を削除
- 変更後、4アカウントすべての一致と、残存セッション・有効更新トークン0件を検証

### Webアプリ

- 商品CSV読込を削除し、ログイン後のSupabase REST取得へ変更
- 商品を1,000件単位でページ取得
- スタッフ確認後にだけ商品・帳合先を取得
- 注文クラウド作成、同期、公開QR、匿名控え取得を削除
- 注文・顧客情報をタブ内メモリだけへ保持
- 印刷画面終了後に対象注文を消去
- ログアウト時に注文、商品、認証セッションを消去
- 旧localStorageの注文・セッション・連番キーを起動時に削除
- localStorageはスタッフ表示名と固定キー左右設定だけに限定
- パスワード欄をログイン試行後に消去

### GitHub公開対象

次をGit追跡対象から外し、`.gitignore` へ追加しました。

- `product_master.csv`
- `outputs/`
- `mobile-production-test.png`
- `exhibition_order_production_preview.html`
- `online-config.js`
- `.env`、Excel、CSV、ローカル監査一時ファイル

GitHub Pagesは `scripts/build-site.mjs` の許可リストで、画面コード、一般公開ロゴ、環境変数から生成した公開設定だけを配信します。

### 2026-09-03: ログイン継続・安全な注文同期

- 新規 `public.exhibition_app_orders` を作成し、有効スタッフだけが閲覧・作成・変更できるRLSを適用
- 匿名の全権限を取消、スタッフのINSERT／UPDATE列を限定、物理DELETEは付与しない
- 作成者・更新者・更新日時はDBトリガーが設定
- 更新日時の一致条件で、他端末による変更への無意識の上書きを防止
- 保存確認後にだけ完了表示、通信応答断の再試行を同じ注文IDで処理し重複防止
- 約12秒ごと、画面復帰、再接続、手動操作で注文一覧を同期
- 印刷・再読み込み・タブ終了・ログアウトでは保存済み注文を削除しない
- 一覧からの非表示は全端末に反映するが、復旧用の行は保持
- 旧環境の対象展示会 `NEO TOKYO 2026` から、削除扱いでない13件を新テーブルへコピー。会社名・電話・明細件数・金額・受付日を照合し一致を確認。旧テーブル22件と他展示会は変更しない
- ログイン継続用トークンをlocalStorageへ保存し、自動更新。パスワードは保存しない
- 旧sessionStorageセッションは移行後に消去
- 未保存の下書きはメモリのみとし、タブ離脱前に警告
- 新規マイグレーション2本をSupabase CLIで作成し、SQLを実環境へ適用
- 注文の未共有・受取待ち・未会計表示を削除。品番検索、注文入力、PDF・印刷は維持

## 3. 修正後の保存場所

### GitHubに残るもの

- HTML、CSS、JavaScript
- UIロジック、印刷ロジック、メモリ消去ロジック
- 一般公開ロゴ
- Supabaseのテーブル・RLSマイグレーション
- 架空データのテスト
- `.env.example` とGitHub Pagesワークフロー
- README、移行報告、テスト報告

### Supabaseに保存するもの

- Authユーザー
- 有効スタッフ権限
- 商品番号、商品名、卸価格、有効状態、画像URL
- 帳合先
- 保存済み注文・顧客情報（新 `exhibition_app_orders`、スタッフのみアクセス可能）
- 旧注文22件（既存環境の保全用として維持）

注文PDFそのものはSupabaseへ送信しません。

### 端末内に保存するもの

- メモリ: 未保存の入力と、その時点で取得した注文・商品マスター
- localStorage: ログイン継続用認証セッション、スタッフ表示名、固定キー左右設定
- sessionStorage: 旧認証セッションは移行後に消去
- 利用者がPDF保存した場合: 選択した保存先に注文PDF

注文・顧客情報をlocalStorageへ保存しません。ログアウト時は端末の認証情報と画面・メモリ上の非公開データを消去しますが、Supabaseの保存済み注文は残します。印刷画面終了後は印刷用DOMだけを消去します。共有端末では利用終了時にログアウトしてください。

## 4. Git履歴に残る情報

現在の追跡対象からファイルを外しても、公開済みの過去コミットには商品CSV、価格Excel、価格画像、埋め込みプレビュー、公開設定が残っています。完全除去には履歴書き換えとforce-pushが必要です。

推奨手順は次のとおりです。

1. リポジトリの完全バックアップを非公開場所へ作成
2. 関係者へ履歴書き換え日時を通知し、pushを一時停止
3. `git filter-repo` で対象パスを全履歴から除去
4. 全ブランチ・タグをforce-push
5. GitHub上のコミット・Pages・Actions artifact・fork・cloneへの残存を確認
6. 関係者は古いcloneを再cloneし、古い履歴を再pushしない

例（承認後に対象パスを再確認して実行）:

```powershell
git filter-repo --sensitive-data-removal --force --invert-paths `
  --path product_master.csv `
  --path online-config.js `
  --path mobile-production-test.png `
  --path exhibition_order_production_preview.html `
  --path-glob "outputs/**"
git push --force --all origin
git push --force --tags origin
```

この操作は共同作業者のcloneと開発履歴に影響するため、今回は実行していません。

## 5. 既存Supabaseの残課題

新アプリは旧注文APIを呼びませんが、既存の注文行と旧Edge FunctionはまだSupabase上にあります。ローカルコードは410を返す停止版へ変更済みですが、実環境へは未デプロイです。

安全側へ閉じるSQL案は [quarantine_legacy_order_api.sql](supabase/proposals/quarantine_legacy_order_api.sql) に分離しました。実行すると旧QR・旧注文共有・旧バッチ処理が動かなくなるため、運用影響を確認して明示承認後に適用します。既存注文行そのものは削除しません。

Supabase Security Advisorで確認した既存警告:

- 旧注文のSECURITY DEFINER関数が匿名または認証ユーザーから実行可能
- `pg_net` が `public` schemaにある
- Authの漏えいパスワード保護が無効

参考:

- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## 6. 初回公開の検証結果（2026-09-02）

- 自動テスト38件すべて合格
- PC 1024px、スマホ390px・320pxで横はみ出しなし
- 認証後の商品検索、追加、注文入力、メモリ登録を架空データで確認
- 印刷操作後に会社名、担当者名、電話番号、備考、商品、数量が消えることを確認
- A4注文書を実印刷DOMから生成し、1ページ・文字切れなしを確認
- 公開ビルドに非公開マスター・価格Excel・非公開画像・顧客情報がないことを確認
- GitHub PagesをActions方式へ切り替え、公開ワークフロー成功を確認
- 公開URL: https://masuda8105-prog.github.io/exhibition-order-production/
- 公開URL上で旧商品CSV、価格画像、埋め込みプレビュー、`.env` がすべて404であることを確認
- 公開Publishable Keyだけを使った匿名の商品取得が401で拒否されることを確認

## 7. 追加変更の検証結果（2026-09-03）

- 自動テスト42件すべて合格、構文チェック・7ファイルの安全なビルド成功
- PC 1024px、スマホ390px・320pxで横はみ出しなし
- ログイン継続、期限切れトークン更新、別ブラウザからの注文取得、自動同期を確認
- オフライン再試行、保存後の応答断、同時編集、元担当者の保持、印刷後のデータ保持を確認
- 実DBのスタッフ権限で作成・変更・非表示を確認しROLLBACK。非スタッフは0件、検証データ残存0件
- 新テーブルのRLS有効、匿名SELECT不可、スタッフ物理DELETE不可を確認
- 公開キーだけの実商品・注文取得はHTTP 401
- 旧注文13件を照合済み。元テーブル22件は維持
- A4 PDFを画像化して確認し、文字切れ・重なりなし。物理プリンターは未確認
- 新テーブル・関数にSecurity Advisor警告なし。第5節の既存警告は継続

詳細は [TEST_REPORT.md](TEST_REPORT.md) を参照してください。
