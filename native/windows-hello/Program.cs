using Windows.Security.Credentials.UI;

// This helper only reports OS authentication. No vault passwords or keys enter it.
try
{
    var availability = await UserConsentVerifier.CheckAvailabilityAsync();
    if (args.Length == 1 && args[0] == "status")
    {
        Console.WriteLine(availability == UserConsentVerifierAvailability.Available ? "available" : "unavailable");
        return;
    }
    if (args.Length != 2 || args[0] != "verify" || !long.TryParse(args[1], out var handle) || handle == 0)
        throw new ArgumentException();
    if (availability != UserConsentVerifierAvailability.Available)
    {
        Console.WriteLine("unavailable");
        return;
    }
    var result = await UserConsentVerifierInterop.RequestVerificationForWindowAsync(
        new IntPtr(handle), "解锁 Jiazi Vault 保险库");
    Console.WriteLine(result == UserConsentVerificationResult.Verified ? "verified"
        : result == UserConsentVerificationResult.Canceled ? "canceled" : "failed");
}
catch
{
    Console.WriteLine("failed");
    Environment.ExitCode = 1;
}
