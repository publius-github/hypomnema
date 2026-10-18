# Additional permission under GNU GPL version 3 section 7

Hypomnema is licensed under the GNU General Public License, version 3 only (see [LICENSE](LICENSE)), with the following additional permission granted by the copyright holder under section 7 of that license.

> If you modify this Program, or any covered work, by linking or combining it with Google Play services (the libraries published by Google LLC under the `com.google.android.gms` group, or a modified version of them), containing parts covered by the terms of the Android Software Development Kit License or another proprietary Google license, the licensors of this Program grant you additional permission to convey the resulting work. Corresponding Source for a non-source form of such a combination shall not include the source code for the parts of Google Play services used, nor need it include the source code those parts would require under section 1 of the GNU GPL.

What it means in practice: the Android build signs in to Google through Google Play services, which is proprietary. Without this permission nobody - only the copyright holder - could distribute that build under the GPL. With it, anyone may build and share the Android app, and the rest of the GPL still applies in full: the source of Hypomnema itself, with any changes, must stay available under the same terms.

The permission is optional, as section 7 allows: if you modify Hypomnema, you may remove it from your version. A version that no longer uses Google Play services does not need it.

Contributions to this repository are accepted under GPL-3.0-only together with this permission (see [CONTRIBUTING.md](CONTRIBUTING.md)).
