// Android has no desktop notification center to push to.

package notifier

func defaultPush(title, message string) error {
	return nil
}
