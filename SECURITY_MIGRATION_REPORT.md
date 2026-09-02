# セキュリティ移行報告書

作成日: 2026-09-02

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

新しいアプリは注文・顧客情報をSupabaseへ保存しません。

### 端末内に保存するもの

- メモリ: 入力中・印刷前の注文と、その時点で取得した商品マスター
- sessionStorage: タブ中のSupabase認証セッション
- localStorage: スタッフ表示名、固定キー左右設定

印刷後またはログアウト後、対象注文・顧客情報・商品明細は残しません。

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

## 6. 検証結果

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
