if (typeof window !== "undefined" && typeof document !== "undefined") {
  // Client-side authentication logic (login, signup, logout) goes here
  // Check if we are on the signup page
  if (document.getElementById("signupForm")) {
    document
      .getElementById("signupForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("signupEmail").value;
        const password = document.getElementById("signupPassword").value;
        try {
          const res = await fetch("/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          alert("Sign-up successful! Redirecting to login.");
          window.location.href = "/login.html";
        } catch (err) {
          alert("Error: " + err.message);
        }
      });
  }

  // Check if we are on the login page
  if (document.getElementById("loginForm")) {
    document
      .getElementById("loginForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("loginEmail").value;
        const password = document.getElementById("loginPassword").value;
        try {
          const res = await fetch("/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          // Store the token in localStorage
          localStorage.setItem("token", data.token);
          window.location.href = "/index.html";
        } catch (err) {
          alert("Error: " + err.message);
        }
      });
  }

  // Reset Password Logic
  if (document.getElementById("resetPasswordForm")) {
    document
      .getElementById("resetPasswordForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get("token");
        const newPassword = document.getElementById("newPassword").value;

        try {
          const res = await fetch("/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, newPassword }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          alert("Password reset successful! Redirecting to login.");
          window.location.href = "/login.html";
        } catch (err) {
          alert("Error: " + err.message);
        }
      });
  }
}
