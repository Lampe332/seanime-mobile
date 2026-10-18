package com.seanime.app

import org.junit.Assert.*
import org.junit.Test

class UpdateInstallPolicyTest {
    @Test fun onlyInstalledTargetConfirmsSuccess() {
        assertFalse(UpdateInstallPolicy.installed(31024, 31025, 31024))
        assertTrue(UpdateInstallPolicy.installed(31024, 31025, 31025))
        assertTrue(UpdateInstallPolicy.installed(31024, 31025, 31026))
    }
    @Test fun missingOrNonIncreasingTransactionNeverConfirms() {
        assertFalse(UpdateInstallPolicy.installed(-1, 31025, 31025))
        assertFalse(UpdateInstallPolicy.installed(31024, -1, 31025))
        assertFalse(UpdateInstallPolicy.installed(31025, 31025, 31025))
        assertFalse(UpdateInstallPolicy.installed(31025, 31024, 31026))
    }
}
