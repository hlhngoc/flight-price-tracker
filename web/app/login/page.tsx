export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main>
      <div className="login-wrap">
        <h1>Flight Price Tracker</h1>
        <form className="stack" action="/api/login" method="post">
          <label>
            Mật khẩu
            <input type="password" name="password" required autoFocus />
          </label>
          {error && <p className="error">Sai mật khẩu.</p>}
          <button type="submit">Đăng nhập</button>
        </form>
      </div>
    </main>
  );
}
