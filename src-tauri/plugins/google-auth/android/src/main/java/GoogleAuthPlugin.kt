package com.hypomnema.googleauth

import android.accounts.Account
import android.app.Activity
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.identity.RevokeAccessRequest
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope

/** Only the app's own hidden folder in the user's Drive. */
private const val DRIVE_APPDATA = "https://www.googleapis.com/auth/drive.appdata"

@InvokeArg
class AuthorizeArgs {
  /** False for a sync pass: never put a screen in front of the user. */
  var interactive: Boolean = false
  /** The account signed in before; null lets Google ask which one. */
  var email: String? = null
}

@InvokeArg
class TokenArgs {
  lateinit var token: String
}

@InvokeArg
class RevokeArgs {
  lateinit var email: String
}

/**
 * Google sign-in for the phone, through Google Identity Services'
 * AuthorizationClient. Play services keeps the grant and refreshes the
 * access token itself, so the Rust core holds no refresh token on
 * Android: it asks here for a token before every sync pass, and the
 * answer comes back without any UI once the user has agreed.
 */
@TauriPlugin
class GoogleAuthPlugin(private val activity: Activity) : Plugin(activity) {
  private val client get() = Identity.getAuthorizationClient(activity)

  private fun request(email: String?): AuthorizationRequest {
    val builder = AuthorizationRequest.builder()
      .setRequestedScopes(listOf(Scope(DRIVE_APPDATA)))
    if (!email.isNullOrEmpty()) builder.setAccount(Account(email, "com.google"))
    return builder.build()
  }

  @Command
  fun authorize(invoke: Invoke) {
    val args = invoke.parseArgs(AuthorizeArgs::class.java)
    client.authorize(request(args.email))
      .addOnSuccessListener { result ->
        if (!result.hasResolution()) {
          resolveToken(invoke, result)
          return@addOnSuccessListener
        }
        val pending = result.pendingIntent
        if (!args.interactive || pending == null) {
          invoke.reject("Google needs you to sign in again", "CONSENT_REQUIRED")
          return@addOnSuccessListener
        }
        // The account picker and consent screen; the answer arrives in
        // authorizeResult below.
        startIntentSenderForResult(
          invoke,
          IntentSenderRequest.Builder(pending.intentSender).build(),
          "authorizeResult"
        )
      }
      .addOnFailureListener { e -> invoke.reject(describe(e), e) }
  }

  @ActivityCallback
  fun authorizeResult(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK) {
      invoke.reject("Google sign-in was cancelled", "CANCELLED")
      return
    }
    try {
      resolveToken(invoke, client.getAuthorizationResultFromIntent(result.data))
    } catch (e: ApiException) {
      invoke.reject(describe(e), e)
    }
  }

  private fun resolveToken(invoke: Invoke, result: AuthorizationResult) {
    val token = result.accessToken
    if (token.isNullOrEmpty()) {
      invoke.reject("Google returned no access token")
      return
    }
    val out = JSObject()
    out.put("accessToken", token)
    invoke.resolve(out)
  }

  /** Drops a cached token Google Drive refused, so the next authorize mints a fresh one. */
  @Command
  fun clearToken(invoke: Invoke) {
    val args = invoke.parseArgs(TokenArgs::class.java)
    client.clearToken(ClearTokenRequest.builder().setToken(args.token).build())
      .addOnSuccessListener { invoke.resolve() }
      .addOnFailureListener { e -> invoke.reject(describe(e), e) }
  }

  /** Withdraws the app's Drive access for the account (sign-out). */
  @Command
  fun revoke(invoke: Invoke) {
    val args = invoke.parseArgs(RevokeArgs::class.java)
    val request = RevokeAccessRequest.builder()
      .setAccount(Account(args.email, "com.google"))
      .setScopes(listOf(Scope(DRIVE_APPDATA)))
      .build()
    client.revokeAccess(request)
      .addOnSuccessListener { invoke.resolve() }
      .addOnFailureListener { e -> invoke.reject(describe(e), e) }
  }

  private fun describe(e: Exception): String =
    if (e is ApiException) "Google sign-in failed (${e.statusCode}): ${e.message}"
    else "Google sign-in failed: ${e.message}"
}
