(function () {
    const SELECTOR = 'button, .settingsNavItem, #user_content, #server_status_wrapper, .loginOptionButton, .serverSearchGlobalButton, .lbTab'

    document.addEventListener('click', (event) => {
        const target = event.target.closest ? event.target.closest(SELECTOR) : null
        if (target == null || target.disabled) {
            return
        }
        target.classList.remove('btClick')
        void target.offsetWidth
        target.classList.add('btClick')
        setTimeout(() => target.classList.remove('btClick'), 320)
    }, true)
})()
