$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$path = 'C:\Users\Administrator\.claude\projects\E--QMAI\282997c5-b3c4-46ce-9c34-e84e039e78a4.jsonl'
$lines = Get-Content $path -Encoding UTF8
$i = 0
foreach ($l in $lines) {
    $i++
    if ($i -lt 936) { continue }
    try { $o = $l | ConvertFrom-Json } catch { continue }
    if ($o.type -eq 'assistant') {
        $c = $o.message.content
        if ($c -is [array]) {
            foreach ($p in $c) {
                if ($p.type -eq 'text' -and $p.text) {
                    $t = $p.text
                    if ($t.Length -lt 1500) {
                        if ($t.Length -gt 400) { $t = $t.Substring(0, 400) + '...' }
                        Write-Output ("A[" + $i + "] " + $t)
                        Write-Output "----"
                    }
                }
            }
        }
    }
}
